# Agents

- Read `PROJECT_STATUS.md` and `MEMORY.md` before editing.
- Read `GChoPro-PRD.md` before adding product behavior. It is the source of truth. `PRD.md` is only the launch index.
- Query graphify before a broad file search, once `.planning/graphs/graph.json` exists.
- Keep the theme in `DESIGN.md`. Change it only when the user asks.
- Prefer the free stack recorded in `MEMORY.md`. The PRD names that stack.
- Docs: `GChoPro-PRD.md`, `PRD.md`, `docs/RUNBOOK.md`, `docs/ARCHITECTURE.md`, `SECURITY.md`.
- Business logic belongs in `packages/core`. Route handlers stay thin and validate with Zod.
- Do not add features that disguise traffic, rotate SIMs to dodge blocks, move a blocked SIM's messages, or automatically recover a suspended SIM.
- Do not commit secrets. Configuration comes from the environment.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context. See `docs/agents/domain.md`.
