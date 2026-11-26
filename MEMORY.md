# Memory

## Decisions

- 2026-11-25 — Follow GChoPro-PRD.md §21 (pnpm, Turborepo, Next.js, PostgreSQL 16, Redis, Drizzle) — the PRD names the stack, so the launch-project npm/SQLite default does not apply.
- 2026-11-25 — Node.js 22 via fnm for this repo — the PRD requires Node 22 LTS. The system Node 24 install stays in place.
- 2026-11-25 — One GitHub issue per milestone M1–M8, blocked in order — GChoPro-PRD.md §24 is the approved breakdown. Finer slices are filed at the start of that milestone.
- 2026-11-25 — Do not install Docker on this machine — the operator asked to commit Compose and schema and to leave the local migrate/seed run unverified. CI runs that check.
- 2026-11-25 — `.env.example` adds `POSTGRES_PASSWORD`, `GCHOPRO_APP_PASSWORD`, and `REDIS_PASSWORD` — Compose and the official images need them, and they are not app secrets inside §23.1. They must match `DATABASE_OWNER_URL`, `DATABASE_URL`, and `REDIS_URL`. Values stay empty in git.
- 2026-11-25 — Grants run after migrations, `stats_daily.user_scope_id` is generated, and seed crypto stays in `packages/db` until M1. See `PROGRESS.md`.

## Stack

- TypeScript 5, Node.js 22, pnpm workspaces, Turborepo, Next.js App Router, React 19, Tailwind CSS v4 — GChoPro-PRD.md §21.1.
- Zod 4.6.6 — the Zod 3 line has no fix for GHSA-mrhx-c7xc-m3w5, and the audit gate fails on high.
- PostgreSQL 16, Drizzle, Redis 7, BullMQ — same section. BullMQ is wired in a later milestone, not M0.
- Vitest, Playwright, and Android Gradle — added when those suites exist. M0 ships Vitest only.

## Paid later

- Hosted Postgres — Compose Postgres is enough until the M8 server runbook.
- A VPS and a custom domain — GChoPro-PRD.md §25. Not provisioned in M0.
- Sentry or another paid error tracker — pino is the logger. No paid tracker is installed.
- Paid auth — sessions are custom, per §11 and §18.
- DeepL or Google Translate — optional providers. Default translation provider is `none` (§26).
