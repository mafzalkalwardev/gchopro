# Run

## Requirements

- Node.js 22 (this repo pins `.node-version`)
- pnpm 10
- Docker Compose v2, when you want Postgres, Redis, and Mailpit

Docker is not installed on the machine that created this repo. Local `pnpm db:migrate` and `pnpm db:seed` are unverified until Docker exists. CI runs them.

## Setup

1. Install Node.js 22 and enable Corepack.
2. `pnpm install`
3. Copy `.env.example` to `.env`. Fill values with `pnpm gen:secrets` for the crypto keys. Never commit `.env`.
4. When Docker is available: `docker compose -f infra/docker-compose.yml --env-file .env up -d`

## Develop

`pnpm dev` starts the admin app, the portal app, and the worker.

## Test

`pnpm lint`
`pnpm typecheck`
`pnpm test`

Integration tests, Playwright, and the Android build run in GitHub Actions. They are not part of the local check on a machine without Docker.

## Build

`pnpm build`

## Production host

A fresh Ubuntu 24.04 server becomes the production host. Do this before the compose stack is exposed.

1. Create a deploy user. Sign in with SSH keys. Disable password login and root SSH login.
2. `timedatectl set-ntp true`
3. Install unattended upgrades and enable them.
4. Install fail2ban and leave the SSH jail on.
5. Allow only ports 22, 80, and 443 in ufw, then enable ufw.
6. Install Docker Engine and the Compose plugin.
7. Point DNS for the portal host, the gateway host, and the admin host at this server.
8. Configure Docker's log rotation (`max-size` and `max-file`) so a busy worker cannot fill the disk.
9. Create `/etc/gchopro/gchopro.env` from `.env.example`, mode `600`, owned by root. Generate keys with `pnpm gen:secrets` on a trusted machine and paste them. Do not commit the file.

The database URLs inside that file use the compose service names:

```text
DATABASE_URL=postgres://gchopro_app:PASSWORD@postgres:5432/gchopro
DATABASE_OWNER_URL=postgres://gchopro_owner:PASSWORD@postgres:5432/gchopro
REDIS_URL=redis://:PASSWORD@redis:6379/0
```

Set `APP_ENV=staging` for the first boot. Set `BACKUP_ENABLED=true` only after `BACKUP_AGE_RECIPIENT`, `BACKUP_AGE_IDENTITY`, and `BACKUP_RCLONE_REMOTE` are real. `ADMIN_IP_ALLOWLIST` is comma-separated. Caddy converts it to the space-separated list its matcher expects.

Postgres and Redis publish no ports. Caddy publishes 80 and 443. Admin, portal, and the worker run as `node` with a read-only root filesystem.

## First boot

From a checkout on the server:

```text
export GCHOPRO_ENV_FILE=/etc/gchopro/gchopro.env
docker compose -f infra/docker-compose.prod.yml --env-file "$GCHOPRO_ENV_FILE" up -d --wait
```

The migrate service runs `tsx src/migrate.ts` once. Seed refuses `APP_ENV=production`, so the first admin is created while the file still says `APP_ENV=staging`:

```text
docker compose -f infra/docker-compose.prod.yml --env-file "$GCHOPRO_ENV_FILE" run --rm migrate pnpm --filter @gchopro/db exec tsx src/seed.ts
```

Staging seed does not create demo users. Demo users exist only when `APP_ENV=development`. Change `APP_ENV` to `production` and recreate the app containers before the DNS names are used. Sign in, enroll the authenticator, and change the seed password. Then remove `SEED_ADMIN_PASSWORD` from the env file.

Caddy obtains certificates automatically. A public SSL Labs scan is an operator step after the names resolve. This repo does not record a grade.

`GET /healthz` on the portal and admin hosts returns `ok` with no session. The admin check exists so the container can probe itself.

## Pair a phone

1. In the admin desk, create a pairing. The gateway URL on that screen is the device host.
2. Install the release APK from `docs/ANDROID-SETUP.md`.
3. Enter the pairing code. The phone reports its SIMs. Assign one SIM to a portal user.
4. Confirm a heartbeat on the device page. The phone is online when the last heartbeat is inside `health.offline_after_seconds` (seeded at 90).

## Rotate keys

`pnpm gen:secrets` prints a new field-key set. Add the new key to `FIELD_ENCRYPTION_KEYS`, set `FIELD_ENCRYPTION_ACTIVE_KEY_ID` to it, keep the old key in the set, and run `pnpm db:reencrypt`. Remove the old key only after that command finishes. Session and phone-index keys are rotated by replacing the env value and signing every session out. Do not commit the new values.

## Backups

The worker runs the jobs when `BACKUP_ENABLED=true`. The clock is Asia/Karachi. A backup is due for the whole 02:00 hour, retention for the whole 03:00 hour, and the restore test for the Sunday 04:00 hour. The tick is not aligned to the minute, so a Redis lock (`ops:{kind}:{day}`, 48 hours) runs each job once. If the task throws, the lock is deleted and the next tick retries. If the script fails and the error is caught, the lock stays so the job does not retry every minute.

`infra/backup/backup.sh` writes a custom-format `pg_dump`, encrypts it with age, and copies it with rclone. Redis is not backed up. `infra/backup/restore-test.sh` decrypts the newest archive into a throwaway database, checks that `users` and `settings` have rows, and drops that database. System health shows the Redis timestamps `backup:last` and `backup:restore-test`. A failed run raises `backup_failed`. A successful restore test raises `backup_restore_test` and resolves `backup_failed`.

To restore onto a replacement server, stop the app containers, decrypt the archive with the age identity, and `pg_restore` it into an empty `gchopro` database. Start the stack again. Do not restore by copying files out of the Postgres volume while it is running.

## Retention and delete

Each night at 03:00 Asia/Karachi the worker nulls message bodies and translation rows older than `settings.retention.message_body_days` (seeded at 180). Conversation previews older than that cutoff are cleared. Message metadata stays.

An admin with a recent sudo check can delete one portal user's message data. That anonymizes bodies, translations, peer numbers, contacts, and group names. The user row stays.

## Incident: suspected suspension

A SIM becomes `suspected_suspended` after the configured number of carrier limit signals (seeded at 2). Its queued messages stay on that SIM and are held as `sim_unhealthy`. Do not move those messages to another SIM, and do not swap the SIM to get around the block.

The recovery path is a manual re-test to a number in `settings.test_numbers` or `ADMIN_TEST_NUMBERS`. The re-test is the only send allowed while the SIM is `suspected_suspended`, and it stays on that SIM. A `sent` report returns the SIM to `active` and requeues the held messages. A failed re-test leaves the SIM suspended. An admin pause still holds every send, including a re-test.

## Environment

See `.env.example`. Keys are empty in git. `packages/core` validates them at boot and names a bad key without printing its value.
