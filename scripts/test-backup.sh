#!/usr/bin/env bash
# Prueba de punta a punta: respalda una base con datos, restaura en otra vacía y compara.
# Requiere un PostgreSQL local accesible con las variables PG* (usa bases descartables).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="volt_bk_src_$$"; DST="volt_bk_dst_$$"; TMP="$(mktemp -d)"
cleanup() { psql -d postgres -qc "drop database if exists $SRC" -c "drop database if exists $DST" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
mk() { psql -d postgres -qc "create database $1"; psql -d "$1" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/supabase_stub.sql"; }

mk "$SRC"; mk "$DST"
for f in "$ROOT"/supabase/migrations/*.sql; do psql -d "$SRC" -v ON_ERROR_STOP=1 -q -f "$f"; done
psql -d "$SRC" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users (id, email, email_confirmed_at) values ('11111111-1111-1111-1111-111111111111', 'a@acme.test', now());
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.create_company('Acme');
insert into public.clients (company_id, name) select id, 'Cliente Uno' from public.companies;
select public.save_quote(c.id, null, '{"title":"Prueba","discount_pct":10}'::jsonb,
  '[{"description":"Caño","quantity":6,"unit":"m","unit_price":1500.5}]'::jsonb) from public.companies c;
SQL
count() { psql -d "$1" -Atc "select (select count(*) from auth.users)||'/'||(select count(*) from public.companies)||'/'||(select count(*) from public.clients)||'/'||(select count(*) from public.quotes)||'/'||(select count(*) from public.quote_items)||'/'||(select total from public.quotes limit 1)"; }

export BACKUP_PASSPHRASE='clave-de-prueba-123'
DATABASE_URL="postgresql:///$SRC?host=${PGHOST:-/var/run/postgresql}&port=${PGPORT:-5432}&user=${PGUSER:-postgres}" "$ROOT/scripts/backup.sh" "$TMP/out" >/dev/null
F="$(ls "$TMP"/out/*.tar.enc)"
file "$F" | grep -qi "data\|openssl" && ! tar -tf "$F" >/dev/null 2>&1 && echo "ok  - el backup está cifrado (no es un tar legible)"

# Clave incorrecta: debe fallar
if TARGET_DATABASE_URL="postgresql:///$DST?host=${PGHOST:-/var/run/postgresql}&port=${PGPORT:-5432}&user=${PGUSER:-postgres}" BACKUP_PASSPHRASE='otra' "$ROOT/scripts/restore.sh" "$F" --yes >/dev/null 2>&1; then echo "FAIL - restauró con clave incorrecta"; exit 1; fi
echo "ok  - con clave incorrecta no restaura"
# Sin --yes: debe negarse
if TARGET_DATABASE_URL=x "$ROOT/scripts/restore.sh" "$F" >/dev/null 2>&1; then echo "FAIL - restauró sin --yes"; exit 1; fi
echo "ok  - sin --yes no restaura"
# Archivo alterado: el checksum lo detecta
cp "$F" "$TMP/alt.tar.enc"; cp "$F.sha256" "$TMP/alt.tar.enc.sha256"; sed -i "s/$(basename "$F")/alt.tar.enc/" "$TMP/alt.tar.enc.sha256"; printf 'x' >> "$TMP/alt.tar.enc"
if TARGET_DATABASE_URL=x "$ROOT/scripts/restore.sh" "$TMP/alt.tar.enc" --yes >/dev/null 2>&1; then echo "FAIL - aceptó un archivo alterado"; exit 1; fi
echo "ok  - un archivo alterado se rechaza"

TARGET_DATABASE_URL="postgresql:///$DST?host=${PGHOST:-/var/run/postgresql}&port=${PGPORT:-5432}&user=${PGUSER:-postgres}" "$ROOT/scripts/restore.sh" "$F" --yes >/dev/null
A="$(count "$SRC")"; B="$(count "$DST")"
[ "$A" = "$B" ] || { echo "FAIL - los datos no coinciden: origen=$A destino=$B"; exit 1; }
echo "ok  - datos idénticos tras restaurar (usuarios/empresas/clientes/presupuestos/ítems/total = $B)"
# Las políticas RLS y los permisos sobrevivieron
P="$(psql -d "$DST" -Atc "select count(*) from pg_policies where schemaname='public'")"
[ "$P" -ge 20 ] || { echo "FAIL - faltan políticas RLS ($P)"; exit 1; }
echo "ok  - $P políticas RLS restauradas"
psql -d "$DST" -Atc "select relrowsecurity from pg_class where relname='quotes'" | grep -q t && echo "ok  - RLS sigue activa en quotes"
echo ">>> PRUEBA DE BACKUP/RESTORE OK"
