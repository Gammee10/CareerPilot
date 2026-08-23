# CareerPilot

Autonomous job search & application agent MVP. This repository is implemented
from an approved architecture — see `AGENTS.md` and `docs/` before contributing.

## Quick start (local development)

```powershell
powershell -File scripts/dev-up.ps1
```

Then open http://localhost:8080 (dashboard) and check
http://localhost:8080/api/readyz. Full details: `docs/dev/local-dev.md`.

## Layout

```
apps/backend/    Express + TypeScript authoritative backend & worker role
apps/frontend/   Next.js dashboard (presentation only)
services/ai/     Internal FastAPI capability (non-public; Phase 1 shell)
db/
  migrations/    SQL migrations implementing docs/domain-model.md
  tests/         Schema acceptance tests (append-only, constraints, idempotency)
caddy/           Public entry point config (ADR-055)
scripts/         Dev environment, secrets, schema-test harness
secrets/         File-mounted Compose secrets (git-ignored except README)
docs/dev/        Session continuity: current-state.md, session-log.md, runbooks
```

## Rules of engagement

- Read `AGENTS.md` first. The stack and invariants are non-negotiable.
- Session protocol: read `docs/dev/current-state.md` before work; update it and
  `docs/dev/session-log.md` after every session (`docs/dev/README.md`).
- Secrets never live in env vars, images, or git (`docs/dev/secrets.md`).
