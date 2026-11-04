-- =====================================================================
-- VOLT - Migración 006: planes (Free / Emprendedor / Pro), solicitudes de plan pago,
-- administrador de plataforma y límite mensual de presupuestos.
--
-- IMPORTANTE sobre los pagos: el link de Mercado Pago de VOLT es un link GENERAL. Mercado Pago no le
-- avisa a la base qué plan compró cada empresa, y esta base NO consulta a Mercado Pago. Por eso:
--   * Una empresa solo puede SOLICITAR un plan (queda "pendiente de verificación").
--   * El plan solo cambia cuando un administrador de plataforma lo activa a mano (admin_set_plan),
--     después de comprobar el pago en su cuenta de Mercado Pago.
--   * Nada de esto simula pagos confirmados.
--
-- Límites: Free 10 presupuestos por mes, Emprendedor 30, Pro sin límite (mes calendario, hora de Córdoba).
-- Un plan pago vencido (plan_expires_at < hoy) se comporta como Free.
-- =====================================================================

create type public.plan_code as enum ('free', 'emprendedor', 'pro');

-- ---------- Administradores de la plataforma (los dueños de VOLT; NO son administradores de empresa) ----------
create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;     -- sin políticas ni permisos: solo se consulta por función
revoke all on public.platform_admins from anon, authenticated;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- ---------- Plan de cada empresa ----------
create table public.company_plans (
  company_id        uuid primary key references public.companies(id) on delete cascade,
  plan              public.plan_code not null default 'free',     -- plan ACTIVO (solo lo cambia un administrador de plataforma)
  plan_expires_at   date,                                         -- null = sin vencimiento (Free)
  requested_plan    public.plan_code check (requested_plan in ('emprendedor', 'pro')),   -- solicitud pendiente de verificación
  requested_at      timestamptz,
  payment_reference text check (char_length(payment_reference) <= 80),                   -- dato opcional que escribe el cliente (ej. nº de operación)
  activated_by      uuid references auth.users(id),
  activated_at      timestamptz,
  updated_at        timestamptz not null default now(),
  check (plan = 'free' or plan_expires_at is not null),
  check ((requested_plan is null) = (requested_at is null))
);
alter table public.company_plans enable row level security;
create policy company_plans_select on public.company_plans for select to authenticated
  using (public.is_member(company_id) or public.is_platform_admin());
revoke all on public.company_plans from anon, authenticated;
grant select on public.company_plans to authenticated;           -- escribir: solo por las funciones de abajo

-- Registro de auditoría (quién cambió qué)
create table public.plan_events (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  actor_id    uuid references auth.users(id) default auth.uid(),
  event       text not null check (event in ('requested', 'request_cancelled', 'activated', 'changed', 'reverted_free', 'expired_seen')),
  from_plan   public.plan_code,
  to_plan     public.plan_code,
  expires_at  date,
  reference   text,
  created_at  timestamptz not null default now()
);
create index on public.plan_events (company_id, created_at desc);
alter table public.plan_events enable row level security;
create policy plan_events_select on public.plan_events for select to authenticated
  using (public.is_platform_admin() or public.is_admin(company_id));
revoke all on public.plan_events from anon, authenticated;
grant select on public.plan_events to authenticated;

-- Toda empresa nace en Free (y las existentes se completan acá)
create or replace function public.companies_create_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.company_plans (company_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger trg_companies_create_plan after insert on public.companies
  for each row execute function public.companies_create_plan();
revoke all on function public.companies_create_plan() from public, anon, authenticated;
insert into public.company_plans (company_id) select id from public.companies on conflict do nothing;

-- ---------- Plan efectivo y límite ----------
create or replace function public.effective_plan(cid uuid)
returns public.plan_code language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when cp.plan = 'free' then 'free'::public.plan_code
                when cp.plan_expires_at is not null and cp.plan_expires_at < (now() at time zone 'America/Argentina/Cordoba')::date then 'free'::public.plan_code
                else cp.plan end
      from public.company_plans cp where cp.company_id = cid
  ), 'free'::public.plan_code)                         -- sin fila = Free
$$;
revoke all on function public.effective_plan(uuid) from public, anon, authenticated;

create or replace function public.plan_quote_limit(p public.plan_code)
returns int language sql immutable set search_path = public as $$
  select case p when 'free' then 10 when 'emprendedor' then 30 else null end    -- null = ilimitado
$$;
revoke all on function public.plan_quote_limit(public.plan_code) from public, anon, authenticated;

create or replace function public.quotes_used_this_month(cid uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.quotes
   where company_id = cid
     and created_at >= (date_trunc('month', now() at time zone 'America/Argentina/Cordoba')) at time zone 'America/Argentina/Cordoba'
$$;
revoke all on function public.quotes_used_this_month(uuid) from public, anon, authenticated;

-- El límite se aplica en la base: no depende de que la interfaz lo respete. Cuentan todos los presupuestos
-- creados en el mes (también los cancelados), para que no se pueda esquivar cancelando.
create or replace function public.quotes_enforce_plan()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.plan_code; lim int;
begin
  p := public.effective_plan(new.company_id);
  lim := public.plan_quote_limit(p);
  if lim is not null and public.quotes_used_this_month(new.company_id) >= lim then
    raise exception 'Llegaste al límite de % presupuestos de este mes en el plan %. Pasate a un plan superior para seguir creando.',
      lim, case p when 'free' then 'Free' when 'emprendedor' then 'Emprendedor' else 'Pro' end;
  end if;
  return new;
end $$;
create trigger trg_quotes_enforce_plan before insert on public.quotes
  for each row execute function public.quotes_enforce_plan();
revoke all on function public.quotes_enforce_plan() from public, anon, authenticated;

-- ---------- Estado del plan de MI empresa (lo ve cualquier miembro) ----------
create or replace function public.my_plan_usage(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cp public.company_plans; eff public.plan_code;
begin
  if not public.is_member(p_company) then raise exception 'Sin acceso a la empresa'; end if;
  select * into cp from public.company_plans where company_id = p_company;
  eff := public.effective_plan(p_company);
  return jsonb_build_object(
    'plan', coalesce(cp.plan, 'free'),
    'effective_plan', eff,
    'quote_limit', public.plan_quote_limit(eff),
    'used', public.quotes_used_this_month(p_company),
    'expires_at', cp.plan_expires_at,
    'requested_plan', cp.requested_plan,
    'requested_at', cp.requested_at,
    'payment_reference', cp.payment_reference
  );
end $$;
revoke all on function public.my_plan_usage(uuid) from public, anon;
grant execute on function public.my_plan_usage(uuid) to authenticated;

-- ---------- La empresa SOLICITA un plan pago (no lo activa) ----------
create or replace function public.request_plan(p_company uuid, p_plan public.plan_code, p_reference text default null)
returns void language plpgsql security definer set search_path = public as $$
declare ref text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if not public.is_admin(p_company) then raise exception 'Solo un administrador de la empresa puede solicitar un plan'; end if;
  if p_plan not in ('emprendedor', 'pro') then raise exception 'Plan no válido'; end if;
  if ref is not null and char_length(ref) > 80 then raise exception 'La referencia es demasiado larga (máximo 80 caracteres)'; end if;

  insert into public.company_plans (company_id) values (p_company) on conflict do nothing;
  update public.company_plans
     set requested_plan = p_plan, requested_at = now(), payment_reference = ref, updated_at = now()
   where company_id = p_company;
  insert into public.plan_events (company_id, event, to_plan, reference) values (p_company, 'requested', p_plan, ref);
end $$;
revoke all on function public.request_plan(uuid, public.plan_code, text) from public, anon;
grant execute on function public.request_plan(uuid, public.plan_code, text) to authenticated;

create or replace function public.cancel_plan_request(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_company) then raise exception 'Solo un administrador de la empresa puede cancelar la solicitud'; end if;
  update public.company_plans
     set requested_plan = null, requested_at = null, payment_reference = null, updated_at = now()
   where company_id = p_company and requested_plan is not null;
  if found then
    insert into public.plan_events (company_id, event) values (p_company, 'request_cancelled');
  end if;
end $$;
revoke all on function public.cancel_plan_request(uuid) from public, anon;
grant execute on function public.cancel_plan_request(uuid) to authenticated;

-- ---------- Administración de la plataforma ----------
-- Lista TODAS las empresas con su plan y solicitud. Solo administradores de plataforma.
create or replace function public.admin_list_companies()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Sin acceso'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.requested_at desc nulls last, t.company_name)
      from (
        select c.id as company_id, c.name as company_name, c.created_at,
               coalesce(cp.plan, 'free') as plan,
               public.effective_plan(c.id) as effective_plan,
               cp.plan_expires_at, cp.requested_plan, cp.requested_at, cp.payment_reference, cp.activated_at,
               public.quotes_used_this_month(c.id) as used,
               (select string_agg(coalesce(pr.email, ''), ', ' order by pr.email)
                  from public.memberships m join public.profiles pr on pr.id = m.user_id
                 where m.company_id = c.id and m.role = 'admin') as admin_emails
          from public.companies c left join public.company_plans cp on cp.company_id = c.id
      ) t
  ), '[]'::jsonb);
end $$;
revoke all on function public.admin_list_companies() from public, anon;
grant execute on function public.admin_list_companies() to authenticated;

-- Activa o cambia el plan de una empresa (Free no lleva vencimiento; los pagos sí). Limpia la solicitud.
create or replace function public.admin_set_plan(p_company uuid, p_plan public.plan_code, p_expires date default null)
returns void language plpgsql security definer set search_path = public as $$
declare old public.company_plans; ev text;
begin
  if not public.is_platform_admin() then raise exception 'Sin acceso'; end if;
  if not exists (select 1 from public.companies where id = p_company) then raise exception 'Empresa inexistente'; end if;
  if p_plan <> 'free' and (p_expires is null or p_expires < (now() at time zone 'America/Argentina/Cordoba')::date) then
    raise exception 'Indicá una fecha de vencimiento de hoy en adelante';
  end if;

  insert into public.company_plans (company_id) values (p_company) on conflict do nothing;
  select * into old from public.company_plans where company_id = p_company for update;

  update public.company_plans
     set plan = p_plan,
         plan_expires_at = case when p_plan = 'free' then null else p_expires end,
         requested_plan = null, requested_at = null, payment_reference = null,
         activated_by = auth.uid(), activated_at = now(), updated_at = now()
   where company_id = p_company;

  ev := case when p_plan = 'free' then 'reverted_free' when old.plan = 'free' then 'activated' else 'changed' end;
  insert into public.plan_events (company_id, event, from_plan, to_plan, expires_at, reference)
  values (p_company, ev, old.plan, p_plan, case when p_plan = 'free' then null else p_expires end, old.payment_reference);
end $$;
revoke all on function public.admin_set_plan(uuid, public.plan_code, date) from public, anon;
grant execute on function public.admin_set_plan(uuid, public.plan_code, date) to authenticated;
