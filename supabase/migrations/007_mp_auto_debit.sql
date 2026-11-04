-- =====================================================================
-- 007 · Débito automático mensual con Mercado Pago (preapproval)
-- El plan se activa solo cuando Mercado Pago confirma el cobro (webhook con service_role).
-- El cobro manual con link (request_plan / admin_set_plan) sigue funcionando igual.
-- =====================================================================

-- Precio oficial de cada plan (debe coincidir con src/lib/plans.ts)
create or replace function public.plan_price_ars(p public.plan_code)
returns numeric language sql immutable set search_path = public as $$
  select case p when 'emprendedor' then 9990 when 'pro' then 19990 else 0 end::numeric
$$;

alter table public.company_plans
  add column if not exists mp_preapproval_id text,
  add column if not exists mp_status text check (mp_status in ('pending','authorized','paused','cancelled')),
  add column if not exists mp_plan public.plan_code,
  add column if not exists mp_payer_email text;
create unique index if not exists uq_company_plans_mp_preapproval on public.company_plans(mp_preapproval_id) where mp_preapproval_id is not null;

-- Cobros automáticos recibidos (idempotente por id de pago de Mercado Pago)
create table if not exists public.mp_payments (
  payment_id   text primary key,
  company_id   uuid not null references public.companies(id) on delete cascade,
  plan         public.plan_code not null,
  amount       numeric(12,2) not null,
  expires_at   date not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_mp_payments_company on public.mp_payments(company_id, created_at desc);
alter table public.mp_payments enable row level security;
drop policy if exists mp_payments_read on public.mp_payments;
create policy mp_payments_read on public.mp_payments for select to authenticated
  using (public.is_platform_admin() or public.is_admin(company_id));

alter table public.plan_events drop constraint if exists plan_events_event_check;
alter table public.plan_events add constraint plan_events_event_check
  check (event = any (array['requested','request_cancelled','activated','changed','reverted_free','expired_seen','mp_payment','mp_authorized','mp_cancelled']));

-- Aplica un cobro aprobado: activa/renueva el plan 1 mes. Solo lo llama el webhook (service_role).
create or replace function public.mp_apply_payment(p_company uuid, p_plan public.plan_code, p_payment_id text, p_amount numeric)
returns boolean language plpgsql security definer set search_path = public as $$
declare old public.company_plans; today date := (now() at time zone 'America/Argentina/Cordoba')::date; base date; new_exp date;
begin
  if p_plan not in ('emprendedor','pro') then raise exception 'Plan no válido'; end if;
  if exists (select 1 from public.mp_payments where payment_id = p_payment_id) then return false; end if;
  insert into public.company_plans (company_id) values (p_company) on conflict do nothing;
  select * into old from public.company_plans where company_id = p_company for update;
  base := case when old.plan = p_plan and old.plan_expires_at is not null and old.plan_expires_at >= today then old.plan_expires_at else today end;
  new_exp := (base + interval '1 month')::date;
  insert into public.mp_payments (payment_id, company_id, plan, amount, expires_at) values (p_payment_id, p_company, p_plan, p_amount, new_exp);
  update public.company_plans
     set plan = p_plan, plan_expires_at = new_exp, requested_plan = null, requested_at = null, payment_reference = null,
         activated_at = now(), updated_at = now()
   where company_id = p_company;
  insert into public.plan_events (company_id, actor_id, event, from_plan, to_plan, expires_at, reference)
  values (p_company, null, 'mp_payment', old.plan, p_plan, new_exp, 'mp:' || p_payment_id);
  return true;
end $$;
revoke all on function public.mp_apply_payment(uuid, public.plan_code, text, numeric) from public, anon, authenticated;

-- my_plan_usage ahora informa también el estado del débito automático
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
    'payment_reference', cp.payment_reference,
    'mp_status', cp.mp_status,
    'mp_plan', cp.mp_plan
  );
end $$;
