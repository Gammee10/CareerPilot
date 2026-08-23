# Session Log

Newest entries first. Append-only — never delete or rewrite prior entries.

---

## 2026-08-23 — CI workflow added (Phase 2 prep)

**Done:** Added `.github/workflows/ci.yml` (runs on push to main + PRs) with four jobs: backend lint+typecheck; frontend lint+typecheck+build; ai capability ruff + byte-compile/import smoke test; stack-tests job validating Compose base/prod configs and running `scripts/test-schema.sh`. Committed npm lockfiles for reproducible `npm ci`; added ESLint flat configs and `lint`/`typecheck` scripts to both TS apps; added `services/ai/pyproject.toml` with ruff config. Fixed a real typing bug in `apps/backend/src/server.ts` found by the new typecheck (`process.env.PORT ?? 8080` not narrowed — now uses `config.port`). Added generated `apps/frontend/next-env.d.ts` to `.gitignore`.

**Verified:** Every CI job's exact command sequence executed successfully locally: backend/frontend via npm; ai job inside a `python:3.12-slim` container (`ruff check`, compileall, import); compose config validation (base + prod) and full schema suite via Git Bash. Push triggers the first real GitHub Actions run.

**Deviations surfaced:** none. Dev-tooling only; no runtime architecture changes.

**Next step:** Awaiting decision-maker go-ahead for Phase 2 (T2.1–T2.6).

---

## 2026-08-23 — Phase 1 (T1.1–T1.4) implemented and verified

**Done:**
- Initialized git repo (`main`); scaffolded the Compose baseline: frontend, backend, worker, ai, postgres + Caddy; only Caddy publishes ports; edge/core networks per ADR-055.
- Wrote `db/migrations/0001_init.sql` implementing the approved domain model (accounts, invitations, sessions, dual-control admin changes, exceptional access, preservation holds, audit events, career profiles, profile versions, resume documents/drafts, job sources, discovery runs, source attempts, listings, observations, reconciliations, availability history, search strategy/terms, evaluations, reviews, idempotency records) with append-only triggers (retention-sweep escape hatch via `app.retention_sweep` GUC).
- Secrets wiring: per-container file-mounted Compose secrets, capability-scoped matrix, local-only generator scripts, OCI Vault retrieval procedure script, docs.
- One-command dev env: `scripts/dev-up.ps1` / `.sh`; SQL migration runner in backend image; schema test harness `scripts/test-schema.ps1` / `.sh`.
- Environment: installed Docker Desktop + WSL2 (elevated, reboot) on the dev machine.

**Verified:**
- Full stack healthy (`docker compose ps`: 6/6 healthy); `/api/healthz`, `/api/readyz`, dashboard all served through Caddy :8080 locally.
- `scripts/test-schema.ps1`: ALL SCHEMA TESTS PASSED (append-only rejections, sweep delete+rollback restore, constraint checks incl. self-approval block, one-active-run index, observation dedupe with NULLS NOT DISTINCT).
- Secret absence: repo grep clean; container env clean; frontend has no secret mounts; postgres/backend both consume the mounted password file.

**Deviations surfaced:** none architectural. Implementation-level fixes found by tests: (a) migration owned `schema_migrations` colliding with the runner — moved to runner; (b) append-only trigger returned NULL on permitted sweep deletes, silently cancelling them — now returns OLD, with a test asserting actual row deletion; (c) Caddy empty-DOMAIN env var broke site-label parsing — split into dev Caddyfile (:80) + production Caddyfile via `compose.prod.yaml`; (d) caddy:2-alpine has no admin `/ready` endpoint — healthcheck exercises `/api/healthz` through Caddy instead.

**Next session:** Phase 2 (T2.1–T2.6). Read `AGENTS.md` + this file first. Precondition items (Gemini terms, T4.0 adapter terms) remain open but not yet due.

---

## 2026-08-23 — Architecture handoff complete; no code yet

**Done:**
- Closed the final four architecture decisions and recorded them:
  - ADR-057 daily encrypted PostgreSQL backups + verified monthly restore drills
  - ADR-058 self-hosted file-based observability + Resend administrator alerts (ADR-052 amended accordingly)
  - ADR-059 source portfolio: Greenhouse, Lever, RemoteOK + URL import, with default adapter-limit framework
  - ADR-060 completed ADR-033 pre-onboarding reviews: OCI US East (Ashburn) region/services; Gemini unpaid-tier scope/terms confirmed per ADR-054 boundary
- Updated `docs/architecture.md` with the corresponding accepted sections.
- Created handoff package: `AGENTS.md`, `docs/handoff/implementation-plan.md`, `docs/handoff/tasks.md`.
- Created `docs/dev/` continuity protocol (`README.md`, `current-state.md`, this file).

**Verified:** implementation-readiness review passed; ADRs 001–060 internally consistent; no blocking ambiguity.

**Deviations surfaced:** none.

**Next session:** start Phase 1 (T1.1–T1.4 in `docs/handoff/tasks.md`). Read `AGENTS.md` and `docs/dev/current-state.md` first.
