# Security model

Report a vulnerability through the policy in the repository root `SECURITY.md`. Do not open a public issue.

## Sessions and admin access

Admin sessions require a password and an authenticator. Portal users change a generated password and accept the acceptable-use notice before the inbox. Idle and absolute session windows are enforced. A password change invalidates sessions created before it. Revoking sessions drops the portal browser within 5 seconds. The admin host answers only for `ADMIN_IP_ALLOWLIST`. Anyone else gets 404. CSRF checks the origin host and a double-submit cookie. The CSP nonce is minted per request.

## Device tokens

A device token is 64 hex characters, stored as a hash, and sent as a bearer token. Registering with protocol version 1 returns 426 before the rate limit is consumed. Later device calls require `x-gateway-protocol: 2`. A mismatched, reused, or retired token is rejected. Device routes are the unwrapped JSON on the gateway host. Caddy serves only `/api/devices` and paths under it on that host.

## Data

Message bodies, phone numbers, and contact names are encrypted with the field key. The phone index is an HMAC, not a copy of the number. Postgres and Redis publish no production ports. Backups are age-encrypted custom dumps. They are not served by Caddy. Redis is not in the backup.

The rightmost `X-Forwarded-For` hop is trusted only when it sits in `TRUSTED_PROXY_CIDRS`. A client-supplied header with no trusted hop is ignored.

## Retention

Message bodies and translations older than `settings.retention.message_body_days` are removed. Metadata stays. An admin with sudo can anonymize one portal user's messages, translations, peer numbers, contacts, and group names. The user row stays. The audit row `user.data_deleted` is written in that transaction.

## What this product does not do

Pacing keeps each SIM inside carrier fair-use limits. It is not a way to disguise traffic or evade a carrier control. A suspected suspension does not move that SIM's messages and does not recover itself. The only send allowed on that SIM is a manual re-test, and the re-test stays on that SIM.

## TLS

Production TLS is Caddy's automatic HTTPS, with HSTS and a 2 MB request body cap. A public SSL Labs grade is an operator scan after DNS is live. This repository does not record one.

## Supply chain

The production image is built from `infra/Dockerfile`. `.dockerignore` excludes `.env`, git metadata, `node_modules`, build output, and keystores. CI builds that image and runs it read-only as `node`. Release signing uses `GCHOPRO_KEYSTORE` and is optional, so the debug APK CI builds stays unsigned.
