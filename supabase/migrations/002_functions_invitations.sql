-- =====================================================================
-- VOLT PRESUPUESTOS INTELIGENTES - Migración 002
-- Funciones atómicas (RPC), eventos de historial e invitaciones.
-- Todas las funciones "save_*" son SECURITY INVOKER: corren con los permisos
-- (y la RLS) de quien las llama. No hay atajos de seguridad.
-- =====================================================================

-- ---------- Guardar presupuesto + ítems en UNA transacción ----------
-- p_id null  => crea (estado borrador). p_id con valor => actualiza y reemplaza los ítems.
-- Si cualquier ítem es inválido, no se guarda nada.
create or replace function public.save_quote(
  p_company uuid, p_id uuid, p_quote jsonb, p_items jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  qid uuid;
  it  jsonb;
  pos int := 0;
begin
  if not public.is_member(p_company) then
    raise exception 'Sin acceso a la empresa';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Los ítems deben ser una lista';
  end if;

  if p_id is null then
    insert into public.quotes (company_id, client_id, title, description, discount_pct,
                               travel_cost, payment_terms, issue_date, valid_until)
    values (p_company,
            nullif(p_quote->>'client_id', '')::uuid,
            coalesce(nullif(p_quote->>'title', ''), 'Presupuesto'),
            nullif(p_quote->>'description', ''),
            coalesce(nullif(p_quote->>'discount_pct', '')::numeric, 0),
            coalesce(nullif(p_quote->>'travel_cost', '')::numeric, 0),
            nullif(p_quote->>'payment_terms', ''),
            coalesce(nullif(p_quote->>'issue_date', '')::date, current_date),
            nullif(p_quote->>'valid_until', '')::date)
    returning id into qid;
  else
    update public.quotes set
      client_id     = nullif(p_quote->>'client_id', '')::uuid,
      title         = coalesce(nullif(p_quote->>'title', ''), 'Presupuesto'),
      description   = nullif(p_quote->>'description', ''),
      discount_pct  = coalesce(nullif(p_quote->>'discount_pct', '')::numeric, 0),
      travel_cost   = coalesce(nullif(p_quote->>'travel_cost', '')::numeric, 0),
      payment_terms = nullif(p_quote->>'payment_terms', ''),
      issue_date    = coalesce(nullif(p_quote->>'issue_date', '')::date, issue_date),
      valid_until   = nullif(p_quote->>'valid_until', '')::date
    where id = p_id and company_id = p_company
    returning id into qid;
    if qid is null then
      raise exception 'Presupuesto inexistente';
    end if;
    delete from public.quote_items where quote_id = qid;
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.quote_items (quote_id, catalog_item_id, kind, description,
                                    quantity, unit, unit_price, position)
    values (qid,
            nullif(it->>'catalog_item_id', '')::uuid,
            coalesce(nullif(it->>'kind', '')::public.item_kind, 'material'),
            it->>'description',
            (it->>'quantity')::numeric,
            coalesce(nullif(it->>'unit', ''), 'u'),
            (it->>'unit_price')::numeric,
            pos);
    pos := pos + 1;
  end loop;

  -- fuerza el recálculo final de totales
  update public.quotes set updated_at = now() where id = qid;
  return qid;
end $$;
revoke all on function public.save_quote(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_quote(uuid, uuid, jsonb, jsonb) to authenticated;

-- ---------- Guardar ítem de catálogo + su costo (solo admin) ----------
create or replace function public.save_catalog_item(
  p_company uuid, p_id uuid, p_data jsonb, p_cost numeric
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare cid uuid;
begin
  if not public.is_admin(p_company) then
    raise exception 'Solo un administrador puede modificar el catálogo';
  end if;

  if p_id is null then
    insert into public.catalog_items (company_id, kind, name, unit, unit_price, active)
    values (p_company,
            coalesce(nullif(p_data->>'kind', '')::public.item_kind, 'material'),
            p_data->>'name',
            coalesce(nullif(p_data->>'unit', ''), 'u'),
            (p_data->>'unit_price')::numeric,
            coalesce((p_data->>'active')::boolean, true))
    returning id into cid;
  else
    update public.catalog_items set
      kind       = coalesce(nullif(p_data->>'kind', '')::public.item_kind, kind),
      name       = coalesce(p_data->>'name', name),
      unit       = coalesce(nullif(p_data->>'unit', ''), unit),
      unit_price = coalesce((p_data->>'unit_price')::numeric, unit_price),
      active     = coalesce((p_data->>'active')::boolean, active)
    where id = p_id and company_id = p_company
    returning id into cid;
    if cid is null then raise exception 'Ítem inexistente'; end if;
  end if;

  if p_cost is null then
    delete from public.catalog_costs where catalog_item_id = cid;
  else
    insert into public.catalog_costs (catalog_item_id, company_id, unit_cost)
    values (cid, p_company, p_cost)
    on conflict (catalog_item_id) do update set unit_cost = excluded.unit_cost;
  end if;
  return cid;
end $$;
revoke all on function public.save_catalog_item(uuid, uuid, jsonb, numeric) from public, anon;
grant execute on function public.save_catalog_item(uuid, uuid, jsonb, numeric) to authenticated;

-- ---------- Eventos de historial emitidos por la app (PDF / WhatsApp) ----------
-- La tabla quote_events no admite inserts directos; solo estos dos eventos, y solo de miembros.
create or replace function public.log_quote_event(
  p_quote uuid, p_event text, p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if p_event not in ('pdf_generated', 'whatsapp_prepared') then
    raise exception 'Evento no permitido';
  end if;
  select company_id into cid from public.quotes where id = p_quote;
  if cid is null or not public.is_member(cid) then
    raise exception 'Sin acceso al presupuesto';
  end if;
  insert into public.quote_events (company_id, quote_id, actor_id, event, detail)
  values (cid, p_quote, auth.uid(), p_event, coalesce(p_detail, '{}'::jsonb));
end $$;
revoke all on function public.log_quote_event(uuid, text, jsonb) from public, anon;
grant execute on function public.log_quote_event(uuid, text, jsonb) to authenticated;

-- ---------- Invitaciones (sin service_role ni Edge Functions) ----------
-- El admin registra el email del empleado. Cuando esa persona se registra (o ya tiene cuenta)
-- e inicia sesión con ese email YA CONFIRMADO, la app llama accept_invitations() y queda unida.
create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  email       text not null check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role        public.member_role not null default 'employee',
  invited_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  unique (company_id, email)
);
create index on public.invitations (email);

create or replace function public.invitations_normalize()
returns trigger language plpgsql as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end $$;
create trigger trg_invitations_normalize before insert or update on public.invitations
  for each row execute function public.invitations_normalize();

alter table public.invitations enable row level security;
create policy invitations_admin on public.invitations for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

revoke all on public.invitations from anon;
grant select, insert, update, delete on public.invitations to authenticated;

create or replace function public.accept_invitations()
returns int
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  mail text;
  n int;
begin
  if uid is null then raise exception 'No autenticado'; end if;

  -- Solo con email confirmado: evita que alguien reclame invitaciones ajenas registrando un email que no controla.
  select lower(email) into mail from auth.users
   where id = uid and email_confirmed_at is not null;
  if mail is null then return 0; end if;

  insert into public.memberships (company_id, user_id, role)
  select company_id, uid, role from public.invitations
   where email = mail and expires_at > now()
  on conflict (company_id, user_id) do nothing;
  get diagnostics n = row_count;

  delete from public.invitations where email = mail;
  return n;
end $$;
revoke all on function public.accept_invitations() from public, anon;
grant execute on function public.accept_invitations() to authenticated;
