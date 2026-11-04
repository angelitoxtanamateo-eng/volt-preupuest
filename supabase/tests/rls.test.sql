-- =====================================================================
-- Pruebas de seguridad y lógica de la base de datos (PostgreSQL real).
-- Uso:  ./supabase/tests/run.sh     (crea una base descartable, aplica las migraciones y corre esto)
-- Cada prueba imprime "ok" o aborta con "FAIL".
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
create or replace function tests.login(uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false);
  set role authenticated;
end $$;
create or replace function tests.anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', false);
  set role anon;
end $$;
create or replace function tests.root() returns void language plpgsql as $$
begin reset role; end $$;
create or replace function tests.ok(name text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', name; end if;
  raise notice 'ok  - %', name;
end $$;
create or replace function tests.throws(name text, stmt text, pattern text default '') returns void
language plpgsql as $$
declare msg text;
begin
  begin
    execute stmt;
  exception when others then
    get stacked diagnostics msg = message_text;
    if pattern <> '' and msg !~* pattern then
      raise exception 'FAIL: % (error inesperado: %)', name, msg;
    end if;
    raise notice 'ok  - % [%]', name, left(msg, 70);
    return;
  end;
  raise exception 'FAIL: % (debía fallar y no falló)', name;
end $$;
create or replace function tests.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to public;

-- ---------- Usuarios ----------
select tests.root();
\set alice '11111111-1111-1111-1111-111111111111'
\set bob   '22222222-2222-2222-2222-222222222222'
\set eva   '33333333-3333-3333-3333-333333333333'
\set evil  '44444444-4444-4444-4444-444444444444'
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  (:'alice', 'Alice@Acme.test', now(), '{"full_name":"Alice"}'),
  (:'bob',   'bob@beta.test',   now(), '{}'),
  (:'eva',   'eva@acme.test',   now(), '{"full_name":"Eva"}'),
  (:'evil',  'eva@acme.test',   null,  '{}');          -- mismo email SIN confirmar

-- ---------- Alta de empresas ----------
select tests.anon();
select tests.throws('anon no puede crear empresas', 'select public.create_company(''X'')', 'permission denied');
select tests.login(:'alice');
select public.create_company('Acme Plomería') as acme \gset
select tests.login(:'bob');
select public.create_company('Beta Electricidad') as beta \gset
select tests.login(:'alice');
select tests.ok('alice quedó como admin de su empresa', public.is_admin(:'acme'::uuid));
select tests.ok('alice NO es miembro de Beta', not public.is_member(:'beta'::uuid));
select tests.throws('nadie inserta empresas directo',
  'insert into public.companies(name) values (''Pirata'')', 'row-level security');

-- ---------- Aislamiento de clientes ----------
insert into public.clients (company_id, name, phone) values (:'acme', 'Cliente de Acme', '3585625480');
select tests.login(:'bob');
insert into public.clients (company_id, name) values (:'beta', 'Cliente de Beta');
select tests.ok('bob ve solo sus clientes', (select count(*) from public.clients) = 1);
select tests.throws('bob no puede crear clientes en Acme',
  format('insert into public.clients(company_id, name) values (%L, ''Intruso'')', :'acme'), 'row-level security');
select tests.ok('bob no puede modificar clientes de Acme',
  tests.affected(format('update public.clients set name = ''hack'' where company_id = %L', :'acme')) = 0);
select tests.ok('bob no puede borrar clientes de Acme',
  tests.affected(format('delete from public.clients where company_id = %L', :'acme')) = 0);
select id as beta_client from public.clients \gset
select tests.login(:'alice');
select id as acme_client from public.clients \gset
select tests.ok('alice ve solo su cliente', (select count(*) from public.clients) = 1);
select tests.anon();
select tests.throws('anon no lee clientes', 'select * from public.clients', 'permission denied');

-- ---------- Presupuestos: numeración y totales ----------
select tests.login(:'alice');
select public.save_quote(:'acme'::uuid, null,
  format('{"title":"Cañería cocina","discount_pct":10,"travel_cost":1500,"client_id":"%s"}', :'acme_client')::jsonb,
  '[{"kind":"material","description":"Caño 20mm","quantity":6,"unit":"m","unit_price":1500.50},
    {"kind":"labor","description":"Jornal","quantity":2,"unit":"jornal","unit_price":25000}]'::jsonb) as q1 \gset
select tests.ok('subtotal = suma de ítems (59003.00)', (select subtotal from public.quotes where id = :'q1'::uuid) = 59003.00);
select tests.ok('descuento 10% = 5900.30', (select discount_amount from public.quotes where id = :'q1'::uuid) = 5900.30);
select tests.ok('total = subtotal - descuento + traslado = 54602.70', (select total from public.quotes where id = :'q1'::uuid) = 54602.70);
select tests.ok('primer presupuesto de Acme es el N° 1', (select number from public.quotes where id = :'q1'::uuid) = 1);
select tests.ok('hereda moneda ARS y condiciones de pago de la empresa',
  (select currency = 'ARS' and payment_terms is not null and valid_until = issue_date + 15 from public.quotes where id = :'q1'::uuid));

select tests.login(:'bob');
select public.save_quote(:'beta'::uuid, null, '{"title":"Tablero"}'::jsonb,
  '[{"kind":"material","description":"Térmica","quantity":1,"unit":"u","unit_price":9000}]'::jsonb) as bq1 \gset
select tests.ok('la numeración es independiente por empresa (Beta arranca en 1)',
  (select number from public.quotes where id = :'bq1'::uuid) = 1);
select tests.throws('bob no puede guardar presupuestos en Acme',
  format('select public.save_quote(%L::uuid, null, ''{}''::jsonb, ''[]''::jsonb)', :'acme'), 'Sin acceso');
select tests.ok('bob no ve presupuestos de Acme', (select count(*) from public.quotes where company_id = :'acme') = 0);

select tests.login(:'alice');
select public.save_quote(:'acme'::uuid, null, '{"title":"Segundo"}'::jsonb, '[]'::jsonb) as q2 \gset
select tests.ok('segundo presupuesto de Acme es el N° 2', (select number from public.quotes where id = :'q2'::uuid) = 2);

-- Manipulación desde el cliente
update public.quotes set subtotal = 1, total = 1, discount_amount = 0 where id = :'q1'::uuid;
select tests.ok('subtotal/total falsificados se recalculan desde los ítems',
  (select subtotal = 59003.00 and total = 54602.70 from public.quotes where id = :'q1'::uuid));
select tests.throws('el número no se puede cambiar',
  format('update public.quotes set number = 99 where id = %L', :'q1'), 'no se pueden modificar');
select tests.throws('no se puede mover un presupuesto a otra empresa',
  format('update public.quotes set company_id = %L where id = %L', :'beta', :'q1'), 'row-level security|no se pueden modificar');
select tests.throws('un presupuesto no puede apuntar a un cliente de otra empresa',
  format('update public.quotes set client_id = %L where id = %L', :'beta_client', :'q1'), 'foreign key');
select tests.throws('un ítem no puede apuntar a un ítem de catálogo ajeno (FK compuesta)',
  format('insert into public.quote_items(quote_id, catalog_item_id, description, quantity, unit_price) values (%L, gen_random_uuid(), ''x'', 1, 1)', :'q1'), 'foreign key');

-- Atomicidad: un ítem inválido no deja nada a medias
select count(*) as before_count from public.quotes \gset
select tests.throws('save_quote es atómico: ítem con cantidad 0 aborta todo',
  format('select public.save_quote(%L::uuid, null, ''{"title":"Roto"}''::jsonb, ''[{"description":"ok","quantity":1,"unit_price":5},{"description":"mal","quantity":0,"unit_price":5}]''::jsonb)', :'acme'),
  'check constraint|quantity');
select tests.ok('no quedó ningún presupuesto huérfano', (select count(*) from public.quotes) = :before_count);
select public.save_quote(:'acme'::uuid, null, '{"title":"Tercero"}'::jsonb, '[]'::jsonb) as q3 \gset
select tests.ok('sin huecos en la numeración tras un error (el siguiente es 3)',
  (select number from public.quotes where id = :'q3'::uuid) = 3);

-- Edición: reemplaza los ítems y recalcula
select public.save_quote(:'acme'::uuid, :'q2'::uuid, '{"title":"Segundo editado","discount_pct":0,"travel_cost":0}'::jsonb,
  '[{"kind":"other","description":"Visita técnica","quantity":1,"unit":"u","unit_price":10000}]'::jsonb);
select tests.ok('la edición reemplaza ítems y recalcula el total',
  (select total = 10000 and title = 'Segundo editado' from public.quotes where id = :'q2'::uuid)
  and (select count(*) from public.quote_items where quote_id = :'q2'::uuid) = 1);
select tests.ok('los ítems heredan company_id del presupuesto',
  (select bool_and(company_id = :'acme'::uuid) from public.quote_items where quote_id = :'q1'::uuid));

-- ---------- Catálogo y costos (solo admin) ----------
select public.save_catalog_item(:'acme'::uuid, null,
  '{"kind":"material","name":"Caño termofusión 20","unit":"m","unit_price":1500}'::jsonb, 900) as cat1 \gset
select tests.ok('admin guarda ítem y costo', (select unit_cost from public.catalog_costs where catalog_item_id = :'cat1'::uuid) = 900);
select tests.login(:'bob');
select public.save_catalog_item(:'beta'::uuid, null, '{"name":"Cable 2.5","unit":"m","unit_price":800}'::jsonb, 500) as beta_cat \gset
select public.save_catalog_item(:'beta'::uuid, null, '{"name":"Sin costo","unit":"u","unit_price":1}'::jsonb, null) as beta_cat_nocost \gset
select tests.login(:'alice');
select tests.throws('un costo no puede colgarse de un ítem de otra empresa (FK compuesta)',
  format('insert into public.catalog_costs(catalog_item_id, company_id, unit_cost) values (%L, %L, 1)', :'beta_cat_nocost', :'acme'), 'foreign key');
select tests.throws('save_catalog_item rechaza ítems ajenos',
  format('select public.save_catalog_item(%L::uuid, %L::uuid, ''{"name":"x"}''::jsonb, null)', :'acme', :'beta_cat'), 'inexistente');

-- ---------- Invitaciones y rol empleado ----------
select tests.login(:'bob');
select tests.throws('bob no puede invitar a Acme',
  format('insert into public.invitations(company_id, email) values (%L, ''x@x.com'')', :'acme'), 'row-level security');
select tests.login(:'alice');
insert into public.invitations (company_id, email, role) values (:'acme', '  Eva@Acme.TEST ', 'employee');
select tests.ok('el email de la invitación se normaliza', (select email from public.invitations) = 'eva@acme.test');

select tests.login(:'evil');
select tests.ok('email SIN confirmar no puede reclamar invitaciones', public.accept_invitations() = 0);
select tests.ok('...y no entra a la empresa', not public.is_member(:'acme'::uuid));
select tests.login(:'eva');
select tests.ok('eva (email confirmado) acepta la invitación', public.accept_invitations() = 1);
select tests.ok('eva es miembro pero NO admin', public.is_member(:'acme'::uuid) and not public.is_admin(:'acme'::uuid));
select tests.login(:'alice');
select tests.ok('la invitación se consume', (select count(*) from public.invitations) = 0);

select tests.login(:'eva');
select tests.ok('empleado ve clientes de su empresa', (select count(*) from public.clients) = 1);
select tests.ok('empleado ve el catálogo (precio de venta)', (select count(*) from public.catalog_items) = 1);
select tests.ok('empleado NO ve costos ni márgenes', (select count(*) from public.catalog_costs) = 0);
select tests.throws('empleado no puede crear ítems de catálogo',
  format('insert into public.catalog_items(company_id, name, unit_price) values (%L, ''x'', 1)', :'acme'), 'row-level security');
select tests.throws('empleado no puede usar save_catalog_item', format('select public.save_catalog_item(%L::uuid, null, ''{"name":"x","unit_price":1}''::jsonb, 1)', :'acme'), 'administrador');
select public.save_quote(:'acme'::uuid, null, '{"title":"De Eva"}'::jsonb,
  '[{"description":"Trabajo","quantity":1,"unit_price":100}]'::jsonb) as q_eva \gset
select tests.ok('empleado crea presupuestos', (select created_by = :'eva'::uuid from public.quotes where id = :'q_eva'::uuid));
select tests.ok('empleado NO puede borrar presupuestos',
  tests.affected(format('delete from public.quotes where id = %L', :'q1')) = 0);
select tests.ok('empleado NO puede cambiar roles',
  tests.affected(format('update public.memberships set role = ''admin'' where user_id = %L', :'eva')) = 0);
select tests.ok('empleado NO puede editar la empresa',
  tests.affected('update public.companies set name = ''Mía''') = 0);
select tests.ok('empleado ve a sus compañeros (perfil y email) pero no a otras empresas',
  (select count(*) from public.profiles) = 2 and (select count(*) from public.profiles where email = 'alice@acme.test') = 1);

-- ---------- Equipo ----------
select tests.login(:'alice');
select tests.throws('no se puede dejar la empresa sin administradores',
  format('delete from public.memberships where company_id = %L and user_id = %L', :'acme', :'alice'), 'al menos un administrador');
select tests.throws('ni degradando al único admin',
  format('update public.memberships set role = ''employee'' where company_id = %L and user_id = %L', :'acme', :'alice'), 'al menos un administrador');
update public.memberships set role = 'admin' where user_id = :'eva'::uuid;
select tests.ok('el admin puede promover a un empleado', public.is_admin(:'acme'::uuid));
update public.memberships set role = 'employee' where user_id = :'eva'::uuid;

-- ---------- Estados, historial y estadísticas ----------
select tests.ok('al crear se registra el evento "created"',
  exists (select 1 from public.quote_events where quote_id = :'q1'::uuid and event = 'created'));
update public.quotes set status = 'accepted' where id = :'q1'::uuid;
select tests.ok('el cambio de estado queda en el historial',
  exists (select 1 from public.quote_events where quote_id = :'q1'::uuid and event = 'status_changed'
          and detail->>'from' = 'draft' and detail->>'to' = 'accepted'));
select tests.throws('el historial no admite inserts directos',
  format('insert into public.quote_events(company_id, quote_id, event) values (%L, %L, ''fake'')', :'acme', :'q1'), 'permission denied');
select tests.throws('el historial no se puede borrar', 'delete from public.quote_events', 'permission denied');
select public.log_quote_event(:'q1'::uuid, 'pdf_generated', '{"via":"descarga"}'::jsonb);
select tests.ok('se registra la generación de PDF', exists (select 1 from public.quote_events where event = 'pdf_generated'));
select tests.throws('eventos arbitrarios no permitidos', format('select public.log_quote_event(%L::uuid, ''hack'')', :'q1'), 'no permitido');
select tests.login(:'bob');
select tests.throws('bob no puede registrar eventos en presupuestos ajenos',
  format('select public.log_quote_event(%L::uuid, ''pdf_generated'')', :'q1'), 'Sin acceso');

select tests.login(:'alice');
update public.quotes set status = 'rejected' where id = :'q2'::uuid;
update public.quotes set status = 'sent', valid_until = current_date - 1 where id = :'q3'::uuid;   -- vencido
select tests.ok('estadísticas: 4 presupuestos (1 aceptado, 1 rechazado, 1 vencido, 1 pendiente de Eva)',
  (select total_quotes = 4 and accepted = 1 and rejected = 1 and expired = 1 and pending = 1
     from public.quote_stats where company_id = :'acme'));
select tests.ok('estadísticas: monto aceptado = total del presupuesto aceptado',
  (select accepted_amount from public.quote_stats where company_id = :'acme') = 54602.70);
select tests.login(:'bob');
select tests.ok('bob solo ve estadísticas de su empresa', (select count(*) from public.quote_stats) = 1);

-- ---------- Moneda configurable ----------
select tests.login(:'alice');
update public.companies set currency = 'USD', name = 'Acme Plomería SRL' where id = :'acme'::uuid;
select public.save_quote(:'acme'::uuid, null, '{}'::jsonb, '[]'::jsonb) as q_usd \gset
select tests.ok('los presupuestos nuevos heredan la moneda configurada', (select currency from public.quotes where id = :'q_usd'::uuid) = 'USD');
select tests.ok('los anteriores conservan su moneda', (select currency from public.quotes where id = :'q1'::uuid) = 'ARS');

-- ---------- Logos (Storage) ----------
select tests.ok('el bucket de logos es privado', (select public = false from storage.buckets where id = 'company-assets'));
insert into storage.objects (bucket_id, name) values ('company-assets', :'acme' || '/logo.png');
select tests.throws('un admin no sube archivos a la carpeta de otra empresa',
  format('insert into storage.objects(bucket_id, name) values (''company-assets'', %L)', :'beta' || '/logo.png'), 'row-level security');
select tests.login(:'eva');
select tests.ok('empleado ve el logo de su empresa', (select count(*) from storage.objects) = 1);
select tests.throws('empleado no puede subir logos',
  format('insert into storage.objects(bucket_id, name) values (''company-assets'', %L)', :'acme' || '/otro.png'), 'row-level security');
select tests.root();
insert into storage.objects (bucket_id, name) values ('fotos', 'carpeta-que-no-es-uuid/foto.jpg');
select tests.login(:'eva');
select tests.ok('objetos de otros buckets con carpetas no-UUID no generan errores', (select count(*) from storage.objects where bucket_id = 'fotos') = 0);
select tests.login(:'bob');
select tests.ok('bob no ve el logo de Acme', (select count(*) from storage.objects) = 0);

select tests.root();
\echo
\echo '>>> TODAS LAS PRUEBAS SQL PASARON'
