#!/bin/sh
set -eu
# Caddy's remote_ip matcher takes a space-separated list. The app env is comma-separated.
export ADMIN_IP_ALLOWLIST="$(printf '%s' "${ADMIN_IP_ALLOWLIST:-}" | tr ',' ' ')"
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
