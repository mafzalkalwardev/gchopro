# GChoPro

GChoPro sends and receives SMS through Android phones that have physical SIM cards. An admin console pairs each phone and assigns one SIM to one user. The user portal is the inbox. A worker paces outbound messages. The gateway app on the phone delivers them.

Pacing and limits keep each SIM within carrier fair-use policies and protect deliverability. They are not a mechanism to disguise traffic or evade carrier controls.

The product specification is [GChoPro-PRD.md](GChoPro-PRD.md). [PRD.md](PRD.md) is only the launch index. If they disagree, GChoPro-PRD.md wins.

## Live

- Portal: https://gchopro.induswebagency.com
- Admin: https://gchopro-admin.induswebagency.com
- Gateway: https://gchopro-gw.induswebagency.com

The admin site answers only from allowlisted addresses.

## Run

Node.js 22 and pnpm 10. Copy `.env.example` to `.env` and fill it with `pnpm gen:secrets`. Never commit `.env`.

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the portal, the admin console, and the worker. Postgres and Redis come from Docker Compose when Docker is available:

```bash
docker compose -f infra/docker-compose.yml --env-file .env up -d
```

Production setup, backups, and the host checklist are in [docs/RUNBOOK.md](docs/RUNBOOK.md). Security rules are in [SECURITY.md](SECURITY.md).

## Test

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Playwright, Compose migrate, and the Android build run in GitHub Actions.

## License

[MIT](LICENSE.md)
