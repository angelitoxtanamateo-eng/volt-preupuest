-- =====================================================================
-- VOLT PRESUPUESTOS INTELIGENTES - Migración 001: esquema, RLS y storage
-- Multiempresa: todo dato de negocio lleva company_id y se aísla con RLS.
-- =====================================================================

-- gen_random_uuid() es nativa desde PostgreSQL 13: no hace falta pgcrypto.

-- ---------- Tipos ----------
create type public.member_role as enum ('admin', 'employee');
create type public.quote_status as enum ('draft', 'sent', 'accepted', 'rejected', 'expired');
create type public.item_kind as enum ('material', 'labor', 'other');

-- ---------- Utilidades ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- Empresas ----------
create table public.companies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 2 and 120),
  logo_path        text,                                  -- ruta en Storage: {company_id}/logo.png
  phone            text,
  email            text,
  address          text,
  tax_id           text,                                  -- CUIT (solo informativo, NO es facturación)
  currency         text not null default 'ARS' check (currency ~ '^[A-Z]{3}$'),
  default_validity_days int not null default 15 check (default_validity_days between 1 and 365),
  payment_terms    text not null default '50% de anticipo y saldo contra entrega.',
  quote_seq        bigint not null default 0,             -- contador de numeración por empresa
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_companies_updated before update on public.companies
  for each row execute function public.set_updated_at();

-- ---------- Perfiles (1:1 con auth.users) ----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  created_at  timestamptz not null default now()
);

-- Crea el perfil automáticamente al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
          lower(new.email));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Membresías (usuario <-> empresa, con rol) ----------
create table public.memberships (
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        public.member_role not null default 'employee',
  created_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index on public.memberships (user_id);

-- ---------- Helpers de seguridad (security definer evita recursión de RLS) ----------
create or replace function public.is_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                 where m.company_id = cid and m.user_id = auth.uid());
$$;

create or replace function public.is_admin(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                 where m.company_id = cid and m.user_id = auth.uid() and m.role = 'admin');
$$;

revoke all on function public.is_member(uuid), public.is_admin(uuid) from public, anon;
grant execute on function public.is_member(uuid), public.is_admin(uuid) to authenticated;

-- Alta de empresa: crea la empresa y deja al usuario como admin (atómico)
create or replace function public.create_company(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  insert into public.companies (name) values (p_name) returning id into cid;
  insert into public.memberships (company_id, user_id, role) values (cid, auth.uid(), 'admin');
  return cid;
end $$;
revoke all on function public.create_company(text) from public, anon;
grant execute on function public.create_company(text) to authenticated;

-- ---------- Clientes ----------
create table public.clients (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  phone       text check (phone is null or phone ~ '^[0-9+() -]{6,20}$'),
  address     text,
  notes       text,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index clients_id_company_uk on public.clients (id, company_id);
create index on public.clients (company_id, name);
create trigger trg_clients_updated before update on public.clients
  for each row execute function public.set_updated_at();

-- ---------- Catálogo de servicios / materiales (precio de venta visible a todos) ----------
create table public.catalog_items (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  kind        public.item_kind not null default 'material',
  name        text not null check (char_length(name) between 1 and 160),
  unit        text not null default 'u',               -- u, m, m2, hs, kg...
  unit_price  numeric(14,2) not null check (unit_price >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index catalog_items_id_company_uk on public.catalog_items (id, company_id);
create index on public.catalog_items (company_id, name);
create trigger trg_catalog_updated before update on public.catalog_items
  for each row execute function public.set_updated_at();

-- Costos en tabla aparte: SOLO administradores (los empleados no ven márgenes)
create table public.catalog_costs (
  catalog_item_id uuid primary key,
  company_id      uuid not null references public.companies(id) on delete cascade,
  unit_cost       numeric(14,2) not null check (unit_cost >= 0),
  -- FK compuesta: el costo siempre pertenece a la MISMA empresa que el ítem
  foreign key (catalog_item_id, company_id)
    references public.catalog_items (id, company_id) on delete cascade
);
create index on public.catalog_costs (company_id);

-- ---------- Presupuestos ----------
create table public.quotes (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  number         bigint not null,                       -- correlativo por empresa (lo asigna el trigger)
  client_id      uuid,
  title          text not null default 'Presupuesto',
  description    text,                                  -- texto original / detalle del trabajo
  status         public.quote_status not null default 'draft',
  currency       text not null check (currency ~ '^[A-Z]{3}$'),   -- la completa el trigger con la moneda de la empresa
  subtotal       numeric(14,2) not null default 0,
  discount_pct   numeric(5,2)  not null default 0 check (discount_pct between 0 and 100),
  discount_amount numeric(14,2) not null default 0,
  travel_cost    numeric(14,2) not null default 0 check (travel_cost >= 0),
  total          numeric(14,2) not null default 0,
  payment_terms  text,
  issue_date     date not null default current_date,
  valid_until    date,
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, number),
  -- FK compuesta: el cliente debe ser de la misma empresa (no se puede apuntar a clientes ajenos)
  foreign key (client_id, company_id)
    references public.clients (id, company_id) on delete set null (client_id)
);
create index on public.quotes (company_id, status);
create index on public.quotes (company_id, created_at desc);
create index on public.quotes (client_id);

-- Numeración correlativa segura ante concurrencia + defaults de la empresa
create or replace function public.quotes_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.companies;
begin
  update public.companies set quote_seq = quote_seq + 1
   where id = new.company_id returning * into c;
  if not found then raise exception 'Empresa inexistente'; end if;
  new.number := c.quote_seq;
  new.currency := coalesce(nullif(new.currency, ''), c.currency);   -- hereda la moneda de la empresa
  new.payment_terms := coalesce(new.payment_terms, c.payment_terms);
  new.valid_until := coalesce(new.valid_until, new.issue_date + c.default_validity_days);
  return new;
end $$;
create trigger trg_quotes_before_insert before insert on public.quotes
  for each row execute function public.quotes_before_insert();

-- Totales calculados SIEMPRE en la base: el subtotal sale de los ítems, nunca del cliente.
create or replace function public.quotes_calc_totals()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.subtotal := 0;                                   -- los ítems llegan después
  else
    new.subtotal := coalesce((select sum(line_total) from public.quote_items
                               where quote_id = new.id), 0);
  end if;
  new.discount_amount := round(new.subtotal * new.discount_pct / 100, 2);
  new.total := new.subtotal - new.discount_amount + new.travel_cost;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_quotes_calc before insert or update on public.quotes
  for each row execute function public.quotes_calc_totals();

-- Impide mover un presupuesto a otra empresa o renumerarlo
create or replace function public.quotes_protect_immutable()
returns trigger language plpgsql as $$
begin
  if new.company_id <> old.company_id or new.number <> old.number then
    raise exception 'company_id y number no se pueden modificar';
  end if;
  return new;
end $$;
create trigger trg_quotes_protect before update on public.quotes
  for each row execute function public.quotes_protect_immutable();

-- ---------- Ítems del presupuesto ----------
create table public.quote_items (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  quote_id    uuid not null references public.quotes(id) on delete cascade,
  catalog_item_id uuid,
  kind        public.item_kind not null default 'material',
  description text not null check (char_length(description) between 1 and 300),
  quantity    numeric(12,3) not null check (quantity > 0),
  unit        text not null default 'u',
  unit_price  numeric(14,2) not null check (unit_price >= 0),
  line_total  numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  position    int not null default 0,
  foreign key (catalog_item_id, company_id)
    references public.catalog_items (id, company_id) on delete set null (catalog_item_id)
);
create index on public.quote_items (quote_id);
create index on public.quote_items (company_id);

-- Coherencia: el ítem hereda company_id del presupuesto (no se confía en el cliente)
create or replace function public.quote_items_set_company()
returns trigger language plpgsql as $$
declare cid uuid;
begin
  select company_id into cid from public.quotes where id = new.quote_id;
  if cid is null then raise exception 'Presupuesto inexistente'; end if;
  new.company_id := cid;
  return new;
end $$;
create trigger trg_quote_items_company before insert or update of quote_id on public.quote_items
  for each row execute function public.quote_items_set_company();

-- Cada cambio de ítems "toca" el presupuesto para que el trigger recalcule los totales
create or replace function public.quote_items_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.quotes set updated_at = now() where id = old.quote_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.quote_id <> old.quote_id) then
    update public.quotes set updated_at = now() where id = new.quote_id;
  end if;
  return null;
end $$;
create trigger trg_quote_items_recalc after insert or update or delete on public.quote_items
  for each row execute function public.quote_items_recalc();

-- ---------- Historial de operaciones (auditoría de presupuestos) ----------
create table public.quote_events (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  quote_id    uuid not null references public.quotes(id) on delete cascade,
  actor_id    uuid references auth.users(id) default auth.uid(),
  event       text not null,                              -- created | status_changed | updated | whatsapp_prepared | pdf_generated
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index on public.quote_events (quote_id, created_at desc);
create index on public.quote_events (company_id, created_at desc);

create or replace function public.quotes_log_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.quote_events (company_id, quote_id, event, detail)
    values (new.company_id, new.id, 'created', jsonb_build_object('number', new.number));
  elsif new.status is distinct from old.status then
    insert into public.quote_events (company_id, quote_id, event, detail)
    values (new.company_id, new.id, 'status_changed',
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return null;
end $$;
create trigger trg_quotes_log after insert or update on public.quotes
  for each row execute function public.quotes_log_events();

-- ---------- Vista de estadísticas para el panel (respeta RLS del invocador) ----------
-- Un presupuesto "enviado" cuya vigencia ya pasó cuenta como vencido (sin depender de ningún cron).
create or replace view public.quote_stats with (security_invoker = true) as
select company_id,
       currency,
       count(*)                                                                        as total_quotes,
       count(*) filter (where status = 'accepted')                                     as accepted,
       count(*) filter (where status = 'draft'
                           or (status = 'sent' and (valid_until is null or valid_until >= current_date))) as pending,
       count(*) filter (where status = 'rejected')                                     as rejected,
       count(*) filter (where status = 'expired'
                           or (status = 'sent' and valid_until < current_date))        as expired,
       coalesce(sum(total), 0)                                                         as total_amount,
       coalesce(sum(total) filter (where status = 'accepted'), 0)                      as accepted_amount
from public.quotes
group by company_id, currency;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.companies     enable row level security;
alter table public.profiles      enable row level security;
alter table public.memberships   enable row level security;
alter table public.clients       enable row level security;
alter table public.catalog_items enable row level security;
alter table public.catalog_costs enable row level security;
alter table public.quotes        enable row level security;
alter table public.quote_items   enable row level security;
alter table public.quote_events  enable row level security;

-- companies: miembros leen; solo admin edita; el alta pasa por create_company()
create policy companies_select on public.companies for select to authenticated
  using (public.is_member(id));
create policy companies_update on public.companies for update to authenticated
  using (public.is_admin(id)) with check (public.is_admin(id));
-- (sin policy de insert/delete: nadie crea ni borra empresas desde el cliente)

-- profiles: cada uno ve/edita el suyo; los miembros se ven entre sí (nombre)
create policy profiles_select_self on public.profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.memberships a join public.memberships b on a.company_id = b.company_id
    where a.user_id = auth.uid() and b.user_id = profiles.id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- memberships: miembros ven el equipo; solo admin gestiona
create policy memberships_select on public.memberships for select to authenticated
  using (public.is_member(company_id));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.is_admin(company_id));
create policy memberships_update on public.memberships for update to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.is_admin(company_id));

-- Evita quedarse sin administradores
create or replace function public.memberships_keep_one_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE' and old.role = 'admin')
     or (tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin') then
    if not exists (select 1 from public.memberships
                   where company_id = old.company_id and role = 'admin'
                     and user_id <> old.user_id) then
      raise exception 'La empresa debe conservar al menos un administrador';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_keep_one_admin before update or delete on public.memberships
  for each row execute function public.memberships_keep_one_admin();

-- clients / quotes / quote_items: miembros leen y escriben; borrar solo admin
create policy clients_select on public.clients for select to authenticated using (public.is_member(company_id));
create policy clients_insert on public.clients for insert to authenticated with check (public.is_member(company_id));
create policy clients_update on public.clients for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy clients_delete on public.clients for delete to authenticated using (public.is_admin(company_id));

create policy quotes_select on public.quotes for select to authenticated using (public.is_member(company_id));
create policy quotes_insert on public.quotes for insert to authenticated with check (public.is_member(company_id));
create policy quotes_update on public.quotes for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy quotes_delete on public.quotes for delete to authenticated using (public.is_admin(company_id));

create policy qitems_select on public.quote_items for select to authenticated using (public.is_member(company_id));
create policy qitems_insert on public.quote_items for insert to authenticated with check (public.is_member(company_id));
create policy qitems_update on public.quote_items for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy qitems_delete on public.quote_items for delete to authenticated using (public.is_member(company_id));

-- catálogo: todos leen; solo admin modifica precios
create policy catalog_select on public.catalog_items for select to authenticated using (public.is_member(company_id));
create policy catalog_insert on public.catalog_items for insert to authenticated with check (public.is_admin(company_id));
create policy catalog_update on public.catalog_items for update to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));
create policy catalog_delete on public.catalog_items for delete to authenticated using (public.is_admin(company_id));

-- costos y márgenes: SOLO admin (lectura y escritura)
create policy costs_all on public.catalog_costs for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

-- historial: lectura para miembros; se escribe solo por triggers/RPC (sin insert directo)
create policy events_select on public.quote_events for select to authenticated using (public.is_member(company_id));

-- Permisos base: nada para anon. Se listan SOLO las tablas de VOLT (no se tocan tablas de otras apps
-- que compartan el proyecto Supabase).
revoke all on public.companies, public.profiles, public.memberships, public.clients, public.catalog_items,
              public.catalog_costs, public.quotes, public.quote_items, public.quote_events, public.quote_stats
  from anon;
grant select, insert, update, delete on public.companies, public.profiles, public.memberships, public.clients,
              public.catalog_items, public.catalog_costs, public.quotes, public.quote_items to authenticated;
grant select on public.quote_events, public.quote_stats to authenticated;   -- el historial solo se escribe por triggers/RPC

-- =====================================================================
-- STORAGE: logos por empresa (bucket privado; carpeta = company_id)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-assets', 'company-assets', false, 2097152,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Primera carpeta de la ruta como UUID, o NULL si no lo es. Evita errores de cast cuando el proyecto
-- comparte Storage con otras apps cuyas carpetas no son UUID (is_member/is_admin(NULL) => false).
create or replace function public.folder_company_id(path text)
returns uuid language sql immutable set search_path = public as $$
  select case when (string_to_array(path, '/'))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then ((string_to_array(path, '/'))[1])::uuid end
$$;
revoke all on function public.folder_company_id(text) from public, anon;
grant execute on function public.folder_company_id(text) to authenticated;

create policy assets_select on storage.objects for select to authenticated
  using (bucket_id = 'company-assets' and public.is_member(public.folder_company_id(name)));
create policy assets_write on storage.objects for insert to authenticated
  with check (bucket_id = 'company-assets' and public.is_admin(public.folder_company_id(name)));
create policy assets_update on storage.objects for update to authenticated
  using (bucket_id = 'company-assets' and public.is_admin(public.folder_company_id(name)));
create policy assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'company-assets' and public.is_admin(public.folder_company_id(name)));
