-- =====================================================================
-- VOLT PRESUPUESTOS INTELIGENTES - Migración 003: endurecimiento (avisos del linter de Supabase)
-- =====================================================================

-- search_path fijo en funciones de trigger que no lo tenían
alter function public.set_updated_at()            set search_path = public;
alter function public.invitations_normalize()     set search_path = public;
alter function public.quote_items_set_company()   set search_path = public;
alter function public.quotes_protect_immutable()  set search_path = public;

-- Las funciones que solo sirven como trigger no deben poder llamarse por la API (/rest/v1/rpc/...).
-- Los triggers siguen funcionando: PostgreSQL no exige EXECUTE al usuario que dispara el trigger.
revoke all on function
  public.handle_new_user(), public.memberships_keep_one_admin(), public.quote_items_recalc(),
  public.quotes_before_insert(), public.quotes_calc_totals(), public.quotes_log_events(),
  public.set_updated_at(), public.invitations_normalize(), public.quote_items_set_company(),
  public.quotes_protect_immutable()
from public, anon, authenticated;
