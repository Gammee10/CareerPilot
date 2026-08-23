# Current State

Last updated: 2026-08-23 (Phase 2 implementation session)

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and PRs: backend lint+typecheck; frontend lint+typecheck+build; ai ruff + import smoke test; identity capability integration tests (Postgres service container); compose config validation + schema tests. npm lockfiles committed for reproducible `npm ci`.

## Phase 2 Implementation Map (all under apps/backend/src)

- `identity/tokens.ts` — opaque base64url tokens, SHA-256 hash-only persistence.
- `identity/invitations.ts` — issue/revoke/accept/lazy-expire (14-day validity); acceptance creates the account (activation) and is idempotent per ADR-025.
- `identity/signinLinks.ts` — request (rate limits 3/15min + 10/24h per email, prior-unused invalidation), confirm (non-consuming), redeem (single-use, 15-min TTL, requires prior confirmation). All failures non-disclosing.
- `identity/sessions.ts` — user 30d absolute/7d idle; admin 12h/1h; idle refresh on validation; revocation on suspension/closure/admin-authority removal.
- `identity/accounts.ts` — active<->suspended<->closed state machine, closure terminal, timestamps cleared on transitions, failure audits persisted outside aborted transactions.
- `identity/adminRoles.ts` — dual-control initiate/approve; self-approval refused+audited; last-admin guard; executed revoke strips privileged sessions immediately.
- `middleware/auth.ts` — deny-by-default requireSession / requireAdmin / requireSelf (404 for cross-account to avoid existence disclosure).
- `app.ts` — route surface: public auth endpoints, `/api/me`, six user-scoped resource routes (ownership-guarded placeholders for later phases), admin invitation/account/role-change routes. Bootstrap procedure: `ops/bootstrap-admin.md` + `scripts/bootstrap-admin.sql` (audit-recorded).
- Tests: `apps/backend/test/*.test.ts` (vitest, 48 tests) against disposable `careerpilot_test` DB; CI job `identity`.

## Phase Status

| Phase | Status |
|---|---|
| 1 — Foundation | Complete (T1.1–T1.4 verified; see session log) |
| 2 — Identity, Invitations, Sessions | Complete (T2.1–T2.6 implemented; 48 vitest integration tests passing) |
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

Phase 3 (T3.1–T3.4): resume upload to private Object Storage via short-lived scoped authorization, FastAPI extraction behind the Node-owned background path with ADR-054 minimization, reviewable draft workflow, immutable profile versions with hard-constraint/preference classification. NOTE: T3.2 touches the Gemini precondition — verify current Gemini unpaid-tier terms against ADR-060 before enabling any AI feature; OCI Object Storage credentials also needed for T3.1.
