#!/usr/bin/env bash
# Corre las pruebas SQL contra un PostgreSQL REAL (>= 15) en una base descartable.
# Requiere: psql y acceso a un servidor Postgres. Variables opcionales:
#   PGHOST PGPORT PGUSER PGPASSWORD   (los habituales de libpq)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB="volt_test_$$"
cleanup() { psql -d postgres -qc "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
psql -d postgres -qc "create database $DB" >/dev/null
P="psql -d $DB -v ON_ERROR_STOP=1 -q"
$P -f "$DIR/tests/supabase_stub.sql"
for f in "$DIR"/migrations/*.sql; do $P -f "$f"; done
# -t -A: sin tablas de resultado; solo los avisos "ok - ..." y el resultado final
$P -t -A -f "$DIR/tests/rls.test.sql" 2>&1 | sed -e 's/^psql:[^ ]* //' -e 's/^NOTICE:  //' | grep -v '^$'
