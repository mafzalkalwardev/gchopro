# Architecture

GChoPro has four runtimes. Business rules live in `packages/core`. Apps call that package. They do not reimplement it.

## Runtimes

- `apps/admin` — Next.js admin panel, served on `ADMIN_HOST`.
- `apps/portal` — Next.js user portal on `PORTAL_HOST`, and the device API on `GATEWAY_HOST`.
- `apps/worker` — Node process for queues and scheduled jobs. M0 only keeps the process alive.
- `android/` — gateway app. Not in M0. The fork of sim-desk lands in M2.

## Data

- PostgreSQL 16 via Drizzle in `packages/db`. Schema follows GChoPro-PRD.md §6.
- Redis 7 for rate limits, pub/sub, and BullMQ. Redis clients arrive with the features that need them.
- Migrations run as `gchopro_owner`. The apps connect as `gchopro_app`.

## Request path

Admin and portal handlers parse input with Zod, call `packages/core`, and map the result. Device calls hit `/api/devices/*` on the portal app. M0 does not expose those routes.

## Tests

- Unit tests: Vitest, beside the package they cover.
- Integration and Playwright: added with the routes they exercise.
- Android: `android/` Gradle, from M2.

## M0

M0 boots the monorepo, validates environment variables, and migrates the full schema. It does not authenticate, send SMS, or render product screens.
