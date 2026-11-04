-- =====================================================================
-- VOLT - Migración 004: estado "cancelado".
-- Va sola en su archivo: un valor nuevo de un enum no puede usarse en la misma transacción que lo crea.
-- =====================================================================
alter type public.quote_status add value if not exists 'cancelled';
