#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_OWNER_URL:?DATABASE_OWNER_URL is required}"
: "${BACKUP_AGE_IDENTITY:?BACKUP_AGE_IDENTITY is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"

source_dir="$BACKUP_DIR"
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  case "$BACKUP_RCLONE_REMOTE" in
    :local:*) source_dir="${BACKUP_RCLONE_REMOTE#:local:}" ;;
  esac
fi

latest="$(find "$source_dir" -type f -name '*.age' -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)"
if [ -z "$latest" ]; then
  echo "no backup to restore" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
age -d -i "$BACKUP_AGE_IDENTITY" -o "$work/dump.dump" "$latest"

base="${DATABASE_OWNER_URL%/gchopro}"
admin="${base}/postgres"
restore="${base}/gchopro_restore"
psql "$admin" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS gchopro_restore WITH (FORCE);"
psql "$admin" -v ON_ERROR_STOP=1 -c "CREATE DATABASE gchopro_restore;"
psql "$restore" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
pg_restore --dbname="$restore" --no-owner --no-privileges --exit-on-error "$work/dump.dump"
users="$(psql "$restore" -v ON_ERROR_STOP=1 -Atc "SELECT COUNT(*) FROM users;")"
settings="$(psql "$restore" -v ON_ERROR_STOP=1 -Atc "SELECT COUNT(*) FROM settings;")"
psql "$restore" -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public.messages');" >/dev/null
if [ "$users" -lt 1 ] || [ "$settings" -lt 1 ]; then
  echo "restore integrity failed" >&2
  exit 1
fi
psql "$admin" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS gchopro_restore WITH (FORCE);"
echo "restore-test ok"
