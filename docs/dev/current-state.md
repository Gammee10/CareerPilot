# Current State

Last updated: 2026-08-23 (CI workflow session, Phase 2 prep)

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and PRs: backend lint+typecheck; frontend lint+typecheck+build; ai ruff + import smoke test; compose config validation + schema tests. npm lockfiles committed for reproducible `npm ci`. All job commands verified locally before push.

## Phase Status

| Phase | Status |
|---|---|
| 1 — Foundation | Complete (T1.1–T1.4 verified; see session log) |
| 2 — Identity, Invitations, Sessions | Not started |
| 3 — Profile and Resume Processing | Not started |
| 4 — Source Adapters and Shared Job Pipeline | Not started (T4.0 terms validation is a blocking precondition) |
| 5 — Discovery Orchestration and Background Work | Not started |
| 6 — Hybrid Evaluation | Not started |
| 7 — Dashboard | Not started |
| 8 — Operations | Not started |
| 9 — Release-Validation Gate | Not started |

## Repository State

Git repo initialized on `main`; pushed to https://github.com/Gammee10/CareerPilot.git.

Key paths:
- `compose.yaml` (+ `compose.override.yaml` local debug binds, `compose.prod.yaml` VM overrides) — five services + Caddy; only Caddy publishes host ports; `edge`/`core` networks separate public from private services.
- `db/migrations/0001_init.sql` — full domain-model schema. Append-only tables (`profile_versions`, `evaluations`, `source_listing_observations`, `availability_history`, `audit_events`) enforced by `forbid_mutation()` trigger: UPDATE always rejected; DELETE only when the transaction sets `app.retention_sweep = 'on'` (retention sweeps, ADRs 020/021).
- `db/tests/schema-tests.sql` + `scripts/test-schema.ps1` / `.sh` — schema test suite.
- `apps/backend` (Express+TS server, worker role stub, SQL migration runner), `apps/frontend` (Next.js shell), `services/ai` (FastAPI shell).
- `secrets/README.md`, `scripts/dev-secrets.*`, `scripts/fetch-vault-secrets.sh`, `docs/dev/secrets.md` — secrets wiring.
- `docs/dev/local-dev.md`, root `README.md` — one-command startup.

## Running State

Local stack runs healthy via `powershell -File scripts/dev-up.ps1`
(`docker compose up -d --build --wait`). Entry point http://localhost:8080;
`/api/healthz`, `/api/readyz` live through Caddy.

## Verification Evidence (Phase 1)

- T1.1: all six containers report healthy under `docker compose ps`;
  routing checks: `/api/healthz` → backend ok, `/api/readyz` → DB-ready,
  `/` → dashboard 200 via Caddy.
- T1.2: `scripts/test-schema.ps1` → ALL SCHEMA TESTS PASSED (append-only
  UPDATE/DELETE rejection, retention-sweep delete + rollback restore,
  lifecycle/governance constraints incl. no-self-approval, one-active-run
  coalescing index, observation idempotency with NULLS NOT DISTINCT).
- T1.3: grep secret-scan clean; container env scan clean; frontend has zero
  secret mounts; postgres initialized from `POSTGRES_PASSWORD_FILE`; backend
  reads the same mounted password (readyz proves it).
- T1.4: fresh-clone flow exercised end to end (dev-up creates `.env`,
  generates local-only secrets, builds, migrates, waits healthy).

## Blocking Preconditions (unchanged, not yet due)

1. Gemini unpaid-tier terms verification vs ADR-060 — required before any AI feature (Phase 6/3 extraction).
2. Per-adapter current-API-terms validation records (T4.0) — required before first adapter use (Phase 4).

## OPEN Items Surfaced During Implementation

(none outstanding)

## Environment Notes

- Dev machine: Windows 11, PowerShell; Docker Desktop 29.x installed this
  session (required elevated WSL2 install + reboot).
- Production Caddyfile variant: `caddy/Caddyfile.production`, applied with
  `docker compose -f compose.yaml -f compose.prod.yaml up -d` on the VM.

## Next Step

Awaiting decision-maker go-ahead, then Phase 2 (T2.1–T2.6): invitation lifecycle, passwordless links, sessions, account states, dual-control admin changes, deny-by-default authorization middleware — building on the schema tables already in place.
