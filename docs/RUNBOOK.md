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

`pnpm dev` starts the admin app, the portal app, and the worker. The worker stays idle in M0.

## Test

`pnpm lint`
`pnpm typecheck`
`pnpm test`

## Build

`pnpm build`

## Deploy

Not deployed. The target is a Linux host with Docker, documented in GChoPro-PRD.md §25, and built in milestone M8. No paid host is provisioned.

## Environment

See `.env.example`. Keys are empty in git. `packages/core` validates them at boot and names a bad key without printing its value.
