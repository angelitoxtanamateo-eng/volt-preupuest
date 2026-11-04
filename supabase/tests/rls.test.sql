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
-- Acme usa el plan Pro (sin límite) en las pruebas de abajo, que crean muchos presupuestos; el límite se prueba con Beta
select tests.root();
update public.company_plans set plan = 'pro', plan_expires_at = current_date + 365 where company_id = :'acme'::uuid;
select tests.login(:'alice');

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

-- ---------- Impuestos, anticipo, saldo (migración 005) ----------
select tests.login(:'alice');
select public.save_quote(:'acme'::uuid, null,
  '{"title":"Con IVA","discount_pct":10,"travel_cost":500,"tax_pct":21,"advance_amount":1000}'::jsonb,
  '[{"kind":"material","description":"Caño","quantity":3,"unit_price":1000.50}]'::jsonb) as q_tax \gset
select tests.ok('subtotal = 3001.50', (select subtotal from public.quotes where id = :'q_tax'::uuid) = 3001.50);
select tests.ok('descuento = 300.15', (select discount_amount from public.quotes where id = :'q_tax'::uuid) = 300.15);
select tests.ok('impuesto = 21% sobre (subtotal - descuento + traslado) = 672.28', (select tax_amount from public.quotes where id = :'q_tax'::uuid) = 672.28);
select tests.ok('total = 3873.63', (select total from public.quotes where id = :'q_tax'::uuid) = 3873.63);
select tests.ok('anticipo guardado', (select advance_amount from public.quotes where id = :'q_tax'::uuid) = 1000);
select tests.throws('el porcentaje de impuesto no puede superar 100',
  format('update public.quotes set tax_pct = 150 where id = %L::uuid', :'q_tax'), 'check');
select tests.throws('el anticipo no puede ser negativo',
  format('update public.quotes set advance_amount = -1 where id = %L::uuid', :'q_tax'), 'check');

-- el anticipo no puede superar el total: la verificación es diferida (al confirmar), por eso se prueba fuera de tests.throws
\set ON_ERROR_STOP off
select public.save_quote(:'acme'::uuid, null, '{"title":"EXCEDE-1","advance_amount":999999}'::jsonb,
  '[{"kind":"material","description":"x","quantity":1,"unit_price":100}]'::jsonb);
update public.quotes set advance_amount = 999999 where id = :'q_tax'::uuid;
\set ON_ERROR_STOP on
select tests.ok('anticipo mayor al total: save_quote no guarda nada', (select count(*) from public.quotes where title = 'EXCEDE-1') = 0);
select tests.ok('anticipo mayor al total: el update directo se revierte', (select advance_amount from public.quotes where id = :'q_tax'::uuid) = 1000);

-- el total cambia al editar y el anticipo se revalida contra el total NUEVO
select public.save_quote(:'acme'::uuid, :'q_tax'::uuid,
  '{"title":"Con IVA","discount_pct":0,"travel_cost":0,"tax_pct":0,"advance_amount":3000}'::jsonb,
  '[{"kind":"material","description":"Caño","quantity":3,"unit_price":1000.50}]'::jsonb);
select tests.ok('sin impuesto ni descuento el total es el subtotal', (select total from public.quotes where id = :'q_tax'::uuid) = 3001.50);

-- impuesto por defecto de la empresa
update public.companies set default_tax_pct = 21 where id = :'acme'::uuid;
select public.save_quote(:'acme'::uuid, null, '{}'::jsonb, '[{"kind":"labor","description":"Jornal","quantity":1,"unit_price":1000}]'::jsonb) as q_def \gset
select tests.ok('sin tax_pct explícito se usa el de la empresa (21%)', (select tax_pct = 21 and total = 1210 from public.quotes where id = :'q_def'::uuid));
select public.save_quote(:'acme'::uuid, null, '{"tax_pct":0}'::jsonb, '[{"kind":"labor","description":"Jornal","quantity":1,"unit_price":1000}]'::jsonb) as q_nt \gset
select tests.ok('tax_pct explícito 0 se respeta', (select tax_pct = 0 and total = 1000 from public.quotes where id = :'q_nt'::uuid));

-- duplicar
select public.duplicate_quote(:'q_tax'::uuid) as q_dup \gset
select tests.ok('duplicado: nuevo número correlativo', (select number from public.quotes where id = :'q_dup'::uuid) > (select number from public.quotes where id = :'q_tax'::uuid));
select tests.ok('duplicado: borrador, sin anticipo, mismo total',
  (select d.status = 'draft' and d.advance_amount = 0 and d.total = o.total and d.client_id is not distinct from o.client_id
     from public.quotes d, public.quotes o where d.id = :'q_dup'::uuid and o.id = :'q_tax'::uuid));
select tests.ok('duplicado: copia los ítems', (select count(*) from public.quote_items where quote_id = :'q_dup'::uuid) = 1);
select tests.ok('duplicado: el original no cambia', (select advance_amount from public.quotes where id = :'q_tax'::uuid) = 3000);
select public.duplicate_quote(:'q1'::uuid) as q_dup_ars \gset
select tests.ok('duplicado: conserva la moneda del original aunque la empresa haya cambiado', (select currency from public.quotes where id = :'q_dup_ars'::uuid) = 'ARS');
select tests.login(:'eva');
select tests.ok('un empleado puede duplicar presupuestos de su empresa', public.duplicate_quote(:'q_tax'::uuid) is not null);
select tests.login(:'bob');
select tests.throws('bob no puede duplicar presupuestos ajenos', format('select public.duplicate_quote(%L::uuid)', :'q_tax'), 'inexistente');
select tests.anon();
select tests.throws('anon no ejecuta duplicate_quote', format('select public.duplicate_quote(%L::uuid)', :'q_tax'), 'permission denied');

-- cancelado
select tests.login(:'alice');
select (select cancelled from public.quote_stats where company_id = :'acme' and currency = 'USD') as c0,
       (select total_quotes from public.quote_stats where company_id = :'acme' and currency = 'USD') as t0,
       (select total_amount from public.quote_stats where company_id = :'acme' and currency = 'USD') as a0 \gset
update public.quotes set status = 'cancelled' where id = :'q_dup'::uuid;
select tests.ok('cancelado: se contabiliza aparte y no cuenta como presupuesto ni como monto',
  (select cancelled = :c0 + 1 and total_quotes = :t0 - 1 and total_amount = :a0 - 3001.50
     from public.quote_stats where company_id = :'acme' and currency = 'USD'));
select tests.ok('cancelado: queda en el historial', exists (select 1 from public.quote_events where quote_id = :'q_dup'::uuid and event = 'status_changed' and detail->>'to' = 'cancelled'));

-- saldo de aceptados (total - anticipo) y estadísticas del mes
update public.quotes set status = 'accepted' where id = :'q_tax'::uuid;
select tests.ok('saldo de aceptados = suma de (total - anticipo)',
  (select accepted_balance from public.quote_stats where company_id = :'acme' and currency = 'USD')
  = (select sum(total - advance_amount) from public.quotes where company_id = :'acme' and currency = 'USD' and status = 'accepted'));
select tests.ok('estadísticas del mes: incluyen lo emitido hoy', (select coalesce(sum(total_quotes), 0) from public.quote_stats_month where company_id = :'acme') >= 3);
select tests.ok('estadísticas del mes: enviados/aceptados/rechazados/vencidos suman lo presentado',
  (select submitted = accepted + rejected + expired + (select count(*) from public.quotes where company_id = :'acme' and currency = m.currency and status = 'sent' and issue_date >= date_trunc('month', current_date) and (valid_until is null or valid_until >= current_date))
     from public.quote_stats_month m where company_id = :'acme' and currency = 'USD'));
select tests.login(:'bob');
select tests.ok('bob no ve las estadísticas del mes de Acme', (select count(*) from public.quote_stats_month where company_id = :'acme') = 0);
select tests.anon();
select tests.throws('anon no lee las estadísticas del mes', 'select * from public.quote_stats_month', 'permission denied');

-- ---------- Planes, solicitudes y límite mensual (migración 006) ----------
select tests.root();
insert into public.platform_admins (user_id) values (:'alice');         -- alice es dueña de VOLT en estas pruebas

select tests.login(:'bob');
select tests.ok('toda empresa nueva nace en Free', (select plan = 'free' and plan_expires_at is null from public.company_plans where company_id = :'beta'::uuid));
select tests.ok('bob NO es administrador de plataforma', not public.is_platform_admin());
select tests.throws('la tabla de administradores de plataforma no se lee directo', 'select * from public.platform_admins', 'permission denied');
select tests.throws('bob no puede escribirse un plan Pro', format('update public.company_plans set plan = ''pro'', plan_expires_at = current_date + 30 where company_id = %L::uuid', :'beta'), 'permission denied');
select tests.throws('bob no puede activar planes', format('select public.admin_set_plan(%L::uuid, ''pro'', current_date + 30)', :'beta'), 'Sin acceso');
select tests.throws('bob no puede listar empresas de la plataforma', 'select public.admin_list_companies()', 'Sin acceso');
select tests.ok('bob ve el plan de SU empresa y no el de otra', (select count(*) from public.company_plans) = 1);

-- límite Free: 10 presupuestos por mes
select (select count(*) from public.quotes where company_id = :'beta'::uuid) as k \gset
select count(public.save_quote(:'beta'::uuid, null, '{}'::jsonb, '[]'::jsonb)) from generate_series(1, 10 - :k) \gset
select tests.ok('Free permite hasta 10 presupuestos en el mes', (select count(*) from public.quotes where company_id = :'beta'::uuid) = 10);
select tests.throws('el presupuesto 11 del plan Free se rechaza', format('select public.save_quote(%L::uuid, null, ''{}''::jsonb, ''[]''::jsonb)', :'beta'), 'límite de 10');
select tests.throws('duplicar también cuenta contra el límite', format('select public.duplicate_quote(id) from public.quotes where company_id = %L::uuid limit 1', :'beta'), 'límite de 10');
update public.quotes set status = 'cancelled' where id = (select id from public.quotes where company_id = :'beta'::uuid limit 1);
select tests.throws('cancelar un presupuesto no libera cupo', format('select public.save_quote(%L::uuid, null, ''{}''::jsonb, ''[]''::jsonb)', :'beta'), 'límite de 10');
select tests.ok('mi_plan_usage informa plan, límite y uso', (select (u->>'effective_plan') = 'free' and (u->>'quote_limit')::int = 10 and (u->>'used')::int = 10 from (select public.my_plan_usage(:'beta'::uuid) as u) x));
select tests.throws('quien no es miembro no ve el uso del plan', format('select public.my_plan_usage(%L::uuid)', :'acme'), 'Sin acceso');

-- solicitud de plan (NO activa nada)
select tests.throws('el plan Free no se "solicita"', format('select public.request_plan(%L::uuid, ''free'')', :'beta'), 'no válido');
select tests.throws('no se puede solicitar para una empresa ajena', format('select public.request_plan(%L::uuid, ''pro'')', :'acme'), 'administrador');
select tests.throws('la referencia larga se rechaza', format('select public.request_plan(%L::uuid, ''pro'', %L)', :'beta', repeat('x', 81)), 'demasiado larga');
select public.request_plan(:'beta'::uuid, 'emprendedor', '  Operación 123456  ');
select tests.ok('la solicitud queda pendiente y NO cambia el plan ni el límite',
  (select plan = 'free' and requested_plan = 'emprendedor' and requested_at is not null and payment_reference = 'Operación 123456' from public.company_plans where company_id = :'beta'::uuid));
select tests.throws('con solicitud pendiente el límite sigue siendo el de Free', format('select public.save_quote(%L::uuid, null, ''{}''::jsonb, ''[]''::jsonb)', :'beta'), 'límite de 10');
select tests.ok('la solicitud queda en el registro', exists (select 1 from public.plan_events where company_id = :'beta'::uuid and event = 'requested' and to_plan = 'emprendedor'));
select public.cancel_plan_request(:'beta'::uuid);
select tests.ok('se puede cancelar la solicitud', (select requested_plan is null and requested_at is null and payment_reference is null from public.company_plans where company_id = :'beta'::uuid));
select public.request_plan(:'beta'::uuid, 'pro');

select tests.login(:'eva');
select tests.ok('un empleado ve el uso del plan de su empresa', (public.my_plan_usage(:'acme'::uuid)->>'effective_plan') = 'pro');
select tests.throws('un empleado no puede solicitar planes', format('select public.request_plan(%L::uuid, ''pro'')', :'acme'), 'administrador');

select tests.anon();
select tests.throws('anon no ejecuta request_plan', format('select public.request_plan(%L::uuid, ''pro'')', :'beta'), 'permission denied');
select tests.throws('anon no ejecuta admin_set_plan', format('select public.admin_set_plan(%L::uuid, ''pro'', current_date + 30)', :'beta'), 'permission denied');
select tests.throws('anon no lee los planes', 'select * from public.company_plans', 'permission denied');

-- el administrador de plataforma verifica el pago y activa a mano
select tests.login(:'alice');
select tests.ok('alice es administradora de plataforma', public.is_platform_admin());
select tests.ok('el listado de plataforma incluye ambas empresas y la solicitud pendiente de Beta',
  (select count(*) >= 2 and bool_or(x->>'requested_plan' = 'pro' and x->>'company_name' like 'Beta%') from jsonb_array_elements(public.admin_list_companies()) x));
select tests.ok('el listado incluye el email del administrador de cada empresa',
  (select bool_or(coalesce(x->>'admin_emails', '') <> '') from jsonb_array_elements(public.admin_list_companies()) x));
select tests.throws('un plan pago exige vencimiento', format('select public.admin_set_plan(%L::uuid, ''emprendedor'')', :'beta'), 'vencimiento');
select tests.throws('el vencimiento no puede ser pasado', format('select public.admin_set_plan(%L::uuid, ''emprendedor'', current_date - 1)', :'beta'), 'vencimiento');
select tests.throws('empresa inexistente', 'select public.admin_set_plan(gen_random_uuid(), ''pro'', current_date + 30)', 'inexistente');
select public.admin_set_plan(:'beta'::uuid, 'emprendedor', current_date + 30);
select tests.ok('activar Emprendedor limpia la solicitud y registra quién y cuándo',
  (select plan = 'emprendedor' and plan_expires_at = current_date + 30 and requested_plan is null and activated_by = :'alice'::uuid and activated_at is not null
     from public.company_plans where company_id = :'beta'::uuid));
select tests.ok('queda auditado como activación', exists (select 1 from public.plan_events where company_id = :'beta'::uuid and event = 'activated' and to_plan = 'emprendedor' and actor_id = :'alice'::uuid));

-- límite Emprendedor: 30
select tests.login(:'bob');
select count(public.save_quote(:'beta'::uuid, null, '{}'::jsonb, '[]'::jsonb)) from generate_series(1, 20) \gset
select tests.ok('Emprendedor llega a 30 presupuestos en el mes', (select count(*) from public.quotes where company_id = :'beta'::uuid) = 30);
select tests.throws('el presupuesto 31 del plan Emprendedor se rechaza', format('select public.save_quote(%L::uuid, null, ''{}''::jsonb, ''[]''::jsonb)', :'beta'), 'límite de 30');

-- Pro: sin límite
select tests.login(:'alice');
select public.admin_set_plan(:'beta'::uuid, 'pro', current_date + 30);
select tests.login(:'bob');
select public.save_quote(:'beta'::uuid, null, '{}'::jsonb, '[]'::jsonb);
select tests.ok('Pro no tiene límite mensual', (select count(*) from public.quotes where company_id = :'beta'::uuid) = 31 and (public.my_plan_usage(:'beta'::uuid)->'quote_limit') = 'null'::jsonb);

-- vencimiento: un plan pago vencido vuelve a comportarse como Free
select tests.root();
update public.company_plans set plan_expires_at = current_date - 1 where company_id = :'beta'::uuid;
select tests.login(:'bob');
select tests.ok('plan vencido: el plan efectivo es Free', (public.my_plan_usage(:'beta'::uuid)->>'effective_plan') = 'free');
select tests.throws('plan vencido: se aplica el límite de Free', format('select public.save_quote(%L::uuid, null, ''{}''::jsonb, ''[]''::jsonb)', :'beta'), 'límite de 10');
select tests.ok('plan vencido: los presupuestos ya creados siguen ahí', (select count(*) from public.quotes where company_id = :'beta'::uuid) = 31);

-- volver a Free y cambiar de plan
select tests.login(:'alice');
select public.admin_set_plan(:'beta'::uuid, 'free');
select tests.ok('volver a Free quita el vencimiento', (select plan = 'free' and plan_expires_at is null from public.company_plans where company_id = :'beta'::uuid));
select public.admin_set_plan(:'beta'::uuid, 'pro', current_date + 60);
select public.admin_set_plan(:'beta'::uuid, 'emprendedor', current_date + 60);
select tests.ok('el registro distingue activación, cambio y vuelta a Free',
  (select array_agg(event order by id) filter (where event in ('activated', 'changed', 'reverted_free')) = array['activated', 'changed', 'reverted_free', 'activated', 'changed']
     from public.plan_events where company_id = :'beta'::uuid));
select tests.login(:'bob');
select tests.ok('el administrador de una empresa ve el registro de SU empresa', (select count(*) from public.plan_events where company_id = :'beta'::uuid) >= 5);
select tests.login(:'eva');
select tests.ok('un empleado no ve el registro de planes', (select count(*) from public.plan_events) = 0);

select tests.root();
\echo
\echo '>>> TODAS LAS PRUEBAS SQL PASARON'
