-- =====================================================================
-- VOLT - Migración 005: impuestos configurables, anticipo y saldo, duplicar presupuestos,
-- y estadísticas (histórico y del mes) que excluyen los cancelados.
--
-- Fórmula (idéntica en src/lib/quoteMath.ts):
--   neto      = subtotal - descuento + traslado
--   impuesto  = round(neto * tax_pct / 100, 2)
--   total     = neto + impuesto
--   saldo     = total - anticipo        (se calcula al mostrar; el anticipo no puede superar el total)
-- El "anticipo" es un monto que el negocio declara haber pedido/recibido. La app NO cobra ni verifica pagos.
-- =====================================================================

alter table public.companies
  add column default_tax_pct numeric(5,2) not null default 0 check (default_tax_pct between 0 and 100);

alter table public.quotes
  add column tax_pct        numeric(5,2)  not null default 0 check (tax_pct between 0 and 100),
  add column tax_amount     numeric(14,2) not null default 0,
  add column advance_amount numeric(14,2) not null default 0 check (advance_amount >= 0);

-- ---------- Totales ----------
create or replace function public.quotes_calc_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare net numeric(14,2);
begin
  if tg_op = 'INSERT' then
    new.subtotal := 0;                                   -- los ítems llegan después
  else
    new.subtotal := coalesce((select sum(line_total) from public.quote_items
                               where quote_id = new.id), 0);
  end if;
  new.discount_amount := round(new.subtotal * new.discount_pct / 100, 2);
  net := new.subtotal - new.discount_amount + new.travel_cost;
  new.tax_amount := round(net * new.tax_pct / 100, 2);
  new.total := net + new.tax_amount;
  new.updated_at := now();
  return new;
end $$;

-- El anticipo no puede superar el total. Se verifica AL FINAL de la transacción (diferido), porque
-- save_quote inserta primero el presupuesto (total 0) y después los ítems. Se relee la fila vigente.
create or replace function public.quotes_check_advance()
returns trigger language plpgsql security definer set search_path = public as $$
declare t numeric(14,2); a numeric(14,2);
begin
  select total, advance_amount into t, a from public.quotes where id = new.id;
  if found and a > t then
    raise exception 'El anticipo no puede superar el total del presupuesto';
  end if;
  return null;
end $$;
create constraint trigger trg_quotes_check_advance
  after insert or update on public.quotes
  deferrable initially deferred
  for each row execute function public.quotes_check_advance();
revoke all on function public.quotes_check_advance() from public, anon, authenticated;

-- ---------- save_quote: ahora con impuesto y anticipo ----------
create or replace function public.save_quote(
  p_company uuid, p_id uuid, p_quote jsonb, p_items jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  qid uuid;
  it  jsonb;
  pos int := 0;
  def_tax numeric(5,2);
begin
  if not public.is_member(p_company) then
    raise exception 'Sin acceso a la empresa';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Los ítems deben ser una lista';
  end if;

  if p_id is null then
    select default_tax_pct into def_tax from public.companies where id = p_company;
    insert into public.quotes (company_id, client_id, title, description, discount_pct, travel_cost,
                               tax_pct, advance_amount, payment_terms, issue_date, valid_until)
    values (p_company,
            nullif(p_quote->>'client_id', '')::uuid,
            coalesce(nullif(p_quote->>'title', ''), 'Presupuesto'),
            nullif(p_quote->>'description', ''),
            coalesce(nullif(p_quote->>'discount_pct', '')::numeric, 0),
            coalesce(nullif(p_quote->>'travel_cost', '')::numeric, 0),
            coalesce(nullif(p_quote->>'tax_pct', '')::numeric, def_tax, 0),
            coalesce(nullif(p_quote->>'advance_amount', '')::numeric, 0),
            nullif(p_quote->>'payment_terms', ''),
            coalesce(nullif(p_quote->>'issue_date', '')::date, current_date),
            nullif(p_quote->>'valid_until', '')::date)
    returning id into qid;
  else
    update public.quotes set
      client_id      = nullif(p_quote->>'client_id', '')::uuid,
      title          = coalesce(nullif(p_quote->>'title', ''), 'Presupuesto'),
      description    = nullif(p_quote->>'description', ''),
      discount_pct   = coalesce(nullif(p_quote->>'discount_pct', '')::numeric, 0),
      travel_cost    = coalesce(nullif(p_quote->>'travel_cost', '')::numeric, 0),
      tax_pct        = coalesce(nullif(p_quote->>'tax_pct', '')::numeric, 0),
      advance_amount = coalesce(nullif(p_quote->>'advance_amount', '')::numeric, 0),
      payment_terms  = nullif(p_quote->>'payment_terms', ''),
      issue_date     = coalesce(nullif(p_quote->>'issue_date', '')::date, issue_date),
      valid_until    = nullif(p_quote->>'valid_until', '')::date
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

  update public.quotes set updated_at = now() where id = qid;   -- fuerza el recálculo final
  return qid;
end $$;
revoke all on function public.save_quote(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_quote(uuid, uuid, jsonb, jsonb) to authenticated;

-- ---------- Duplicar un presupuesto (nuevo número, borrador, hoy, sin anticipo) ----------
create or replace function public.duplicate_quote(p_id uuid)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare q public.quotes; nid uuid;
begin
  select * into q from public.quotes where id = p_id;      -- la RLS decide si lo ve
  if not found then raise exception 'Presupuesto inexistente'; end if;

  -- conserva la moneda del original: los precios copiados están expresados en ESA moneda
  insert into public.quotes (company_id, client_id, title, description, currency, discount_pct, travel_cost,
                             tax_pct, advance_amount, payment_terms, issue_date)
  values (q.company_id, q.client_id, q.title, q.description, q.currency, q.discount_pct, q.travel_cost,
          q.tax_pct, 0, q.payment_terms, current_date)
  returning id into nid;

  insert into public.quote_items (quote_id, catalog_item_id, kind, description, quantity, unit, unit_price, position)
  select nid, catalog_item_id, kind, description, quantity, unit, unit_price, position
    from public.quote_items where quote_id = p_id order by position;

  update public.quotes set updated_at = now() where id = nid;
  return nid;
end $$;
revoke all on function public.duplicate_quote(uuid) from public, anon;
grant execute on function public.duplicate_quote(uuid) to authenticated;

-- ---------- Estadísticas: histórico y del mes en curso ----------
-- Los cancelados no cuentan en nada salvo en "cancelled". "Enviado" vencido se considera vencido.
-- accepted_balance = suma de (total - anticipo) de los aceptados: saldo declarado, NO pagos verificados.
drop view if exists public.quote_stats;
create view public.quote_stats with (security_invoker = true) as
select company_id,
       currency,
       count(*) filter (where status <> 'cancelled')                                   as total_quotes,
       count(*) filter (where status = 'accepted')                                     as accepted,
       count(*) filter (where status = 'draft'
                           or (status = 'sent' and (valid_until is null or valid_until >= current_date))) as pending,
       count(*) filter (where status = 'rejected')                                     as rejected,
       count(*) filter (where status = 'expired'
                           or (status = 'sent' and valid_until < current_date))        as expired,
       count(*) filter (where status = 'cancelled')                                    as cancelled,
       coalesce(sum(total) filter (where status <> 'cancelled'), 0)                    as total_amount,
       coalesce(sum(total) filter (where status = 'accepted'), 0)                      as accepted_amount,
       coalesce(sum(total - advance_amount) filter (where status = 'accepted'), 0)     as accepted_balance
from public.quotes
group by company_id, currency;

create view public.quote_stats_month with (security_invoker = true) as
select company_id,
       currency,
       count(*) filter (where status <> 'cancelled')                                   as total_quotes,
       count(*) filter (where status = 'accepted')                                     as accepted,
       count(*) filter (where status = 'draft'
                           or (status = 'sent' and (valid_until is null or valid_until >= current_date))) as pending,
       count(*) filter (where status = 'rejected')                                     as rejected,
       count(*) filter (where status = 'expired'
                           or (status = 'sent' and valid_until < current_date))        as expired,
       count(*) filter (where status in ('sent', 'accepted', 'rejected', 'expired'))   as submitted,
       coalesce(sum(total) filter (where status <> 'cancelled'), 0)                    as total_amount,
       coalesce(sum(total) filter (where status = 'accepted'), 0)                      as accepted_amount,
       coalesce(sum(total - advance_amount) filter (where status = 'accepted'), 0)     as accepted_balance
from public.quotes
where issue_date >= date_trunc('month', current_date)::date
  and issue_date <  (date_trunc('month', current_date) + interval '1 month')::date
group by company_id, currency;

revoke all on public.quote_stats, public.quote_stats_month from anon;
grant select on public.quote_stats, public.quote_stats_month to authenticated;
