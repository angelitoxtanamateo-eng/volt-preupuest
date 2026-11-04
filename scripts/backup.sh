#!/usr/bin/env bash
# Copia de seguridad CIFRADA de la base de datos (esquema public + usuarios de auth).
#
#   DATABASE_URL=postgresql://...  BACKUP_PASSPHRASE='frase-larga' ./scripts/backup.sh [carpeta]
#
# - DATABASE_URL: cadena de conexión de Supabase (Project Settings > Database). Es un SECRETO: nunca en el frontend ni en git.
# - BACKUP_PASSPHRASE: clave con la que se cifra el archivo. Guardala aparte: sin ella el backup no se puede abrir.
# - KEEP_DAYS (opcional, por defecto 30): borra backups locales más viejos.
# Limitación: los ARCHIVOS de Storage (logos) no van en pg_dump; son livianos y se vuelven a subir desde Ajustes.
set -euo pipefail

: "${DATABASE_URL:?Falta DATABASE_URL}"
: "${BACKUP_PASSPHRASE:?Falta BACKUP_PASSPHRASE}"
OUT="${1:-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
umask 077
mkdir -p "$OUT"

# 1) Esquema public completo (estructura, políticas RLS, funciones, permisos y datos)
pg_dump "$DATABASE_URL" --format=custom --no-owner --schema=public --file="$WORK/public.dump"
# 2) Usuarios de autenticación (necesarios para restaurar profiles y membresías)
pg_dump "$DATABASE_URL" --format=custom --no-owner --data-only --table=auth.users --table=auth.identities --file="$WORK/auth.dump" 2>/dev/null \
  || pg_dump "$DATABASE_URL" --format=custom --no-owner --data-only --table=auth.users --file="$WORK/auth.dump"

tar -C "$WORK" -cf "$WORK/bundle.tar" public.dump auth.dump
FILE="$OUT/volt-$STAMP.tar.enc"
# La clave se pasa por variable de entorno (no aparece en la lista de procesos)
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -in "$WORK/bundle.tar" -out "$FILE" -pass env:BACKUP_PASSPHRASE
( cd "$OUT" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256" )

find "$OUT" -name 'volt-*.tar.enc*' -mtime +"$KEEP_DAYS" -delete
echo "Backup creado: $FILE ($(du -h "$FILE" | cut -f1))"
