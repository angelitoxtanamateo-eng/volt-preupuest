#!/usr/bin/env bash
# Restaura un backup creado con backup.sh en la base indicada.
#
#   TARGET_DATABASE_URL=postgresql://...  BACKUP_PASSPHRASE='...' ./scripts/restore.sh archivo.tar.enc --yes
#
# ¡DESTRUCTIVO! Reemplaza el contenido del esquema public de la base destino. Probalo primero en un proyecto
# de prueba. El argumento --yes es obligatorio a propósito.
set -euo pipefail

FILE="${1:?Uso: restore.sh archivo.tar.enc --yes}"
[ "${2:-}" = "--yes" ] || { echo "Falta --yes: esta operación reemplaza datos existentes." >&2; exit 2; }
: "${TARGET_DATABASE_URL:?Falta TARGET_DATABASE_URL}"
: "${BACKUP_PASSPHRASE:?Falta BACKUP_PASSPHRASE}"

if [ -f "$FILE.sha256" ]; then
  ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" ) || { echo "El checksum no coincide: archivo dañado." >&2; exit 3; }
fi
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
umask 077
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in "$FILE" -out "$WORK/bundle.tar" -pass env:BACKUP_PASSPHRASE \
  || { echo "No se pudo descifrar: ¿clave incorrecta?" >&2; exit 4; }
tar -C "$WORK" -xf "$WORK/bundle.tar"

# Primero los usuarios (las tablas de public dependen de ellos), después public
pg_restore --data-only --no-owner --disable-triggers -d "$TARGET_DATABASE_URL" "$WORK/auth.dump" || echo "Aviso: algunos usuarios ya existían (se conservan)."
pg_restore --clean --if-exists --no-owner -d "$TARGET_DATABASE_URL" "$WORK/public.dump"
echo "Restauración terminada."
