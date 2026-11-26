#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_OWNER_URL:?DATABASE_OWNER_URL is required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

pg_dump --dbname="$DATABASE_OWNER_URL" --format=custom --file="$work/dump.dump"
age -r "$BACKUP_AGE_RECIPIENT" -o "$work/gchopro-${stamp}.dump.age" "$work/dump.dump"
rm -f "$work/dump.dump"
install -m 600 "$work/gchopro-${stamp}.dump.age" "$BACKUP_DIR/gchopro-${stamp}.dump.age"

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  rclone copyto \
    "$BACKUP_DIR/gchopro-${stamp}.dump.age" \
    "${BACKUP_RCLONE_REMOTE}/gchopro-${stamp}.dump.age"
fi

find "$BACKUP_DIR" -type f -name '*.age' -mtime +7 -delete

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ] && [ -n "${BACKUP_RETENTION_DAYS:-}" ]; then
  rclone delete "$BACKUP_RCLONE_REMOTE" --min-age "${BACKUP_RETENTION_DAYS}d" --include "*.age"
fi
