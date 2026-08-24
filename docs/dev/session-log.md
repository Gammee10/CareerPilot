# Session Log

Newest entries first. Append-only — never delete or rewrite prior entries.

---

## 2026-08-24 - ADR-030 gate APPROVED; MVP complete through release-validation

**Done:** Recorded decision-maker approval in docs/gate/sign-off.md (status APPROVED, 2026-08-24 UTC). All nine phases complete: foundation, identity, profile/resume processing, source adapters + shared pipeline, discovery/background work, hybrid evaluation, dashboard, operations, and the release-validation gate.

**Verified:** CI green on gate commit b3252d5 (all 5 jobs); vitest 18 files passing at sign-off time.

**Next step:** Operational onboarding (OCI tenancy, production secrets via Vault procedure, compose.prod.yaml deploy, RemoteOK display obligations, restricted Gemini keys). Re-run relevant gate evidence rows on any material change per ADR-030.

## 2026-08-23 - Phase 9 (T9.1-T9.3) gate package complete; sign-off pending

**Done:** T9.2 adversarial untrusted-content suite (test/adversarial.test.ts, 10 tests): prompt-injection payloads planted in structured job fields cannot flip hard-constraint outcomes or trick remote inference; resume-carried instructions cannot add proposal fields or escalate privileges; fabricated evidence refs and requirement claims rejected; lifecycle tampering blocked; append-only snapshots resist mutation. Gate produced two REAL hardening fixes: (a) remote-work inference tightened to strict prefix matching - injection text merely containing 'remote' previously flipped work-mode facts; (b) proposal entry objects now enforce exact key whitelists. T9.1: docs/gate/evidence-checklist.md maps every ADR-030 dimension to executable artifacts with residual items tracked. T9.3: docs/gate/sign-off.md prepared, status PENDING decision-maker approval.

**Verified:** vitest 18 files ALL PASSING (incl. 10 adversarial tests); lint+typecheck clean.

**Deviations surfaced:** none architectural. The two hardening fixes were defects found BY the gate suite and are recorded as gate outcomes, not silent changes.

**Next step:** Decision-maker review of docs/gate/evidence-checklist.md + sign-off in docs/gate/sign-off.md. On APPROVED, beta onboarding may begin.

## 2026-08-23 - Phase 8 (T8.1-T8.5) implemented and verified

**Done:** Structured logging module (withCorrelation/logEvent/withWorkUnit) + T8.1 log-scan journey test proving zero resume/profile/job/AI canaries in emitted logs. Retention sweeps per category schedules with append-only-permitted transactions (resume grace 30d soft-delete, shared 180d, audit 12mo, exceptional access 24mo). ops/backup.sh (pg_dump -Fc -> AES-256-CBC client-side encryption -> integrity decrypt-and-hash -> 90d cleanup -> minimized telemetry; UPLOAD_CMD hook for OCI bucket). ops/health-check.sh with DRY_RUN minimized alert payload (containers/disk/postgres/backup-freshness). ops/restore-drill.sh + deletion-replay.sql sourcing post-backup closure audits from the live immutable log; scripts/test-backup.sh executes full cycle incl. tampered-artifact rejection and replay proof. CI stack-tests job extended.

**Verified:** vitest 17 files ALL PASSING (new logging journey-scan, retention category tests). Backup/drill executed for real in disposable containers: DRILL PASSED with closed_accounts_after_replay=1 (deletion-replay proof) and tamper detection recorded; outcome logged in docs/dev/drill-log.md. Health alert DRY_RUN shows minimized payload only. Local lint+typecheck clean.

**Deviations surfaced:** none architectural. Ops notes: backup key file is a VM/Vault capability secret not mounted into app containers; production upload uses UPLOAD_CMD hook with OCI CLI once tenancy exists (same gap as Phase 3 object store).

**Next step:** Phase 9 (T9.1-T9.3): ADR-030 release-validation gate evidence compilation, adversarial untrusted-content tests, decision-maker sign-off.

## 2026-08-23 - Phase 7 (T7.1-T7.6) implemented and verified

**Done:** Dashboard backend surface: ranked jobs list (eligibility then score; not-interested never re-presented; unavailable shown only when saved), job detail (evidence refs resolved to named fields, preferred/alternative links, RemoteOK-style restrictions surfaced, constraint failures), review lifecycle with strict New->Seen->Saved/Not-interested transitions, evaluate endpoint through the boundary. Disclosure gate (FR-0a): upload grants refused until resume_ai_processing acknowledged; activation notice + acknowledgement endpoint; manual profile path unaffected. Closure flow (FR-0b/ADR-036): request issues FRESH purpose-bound single-use link via new signin_links.purpose, two-step confirm/redeem closes immediately revoking sessions, truthful +30d deletion status, replay/stale/unconfirmed links all fail safely non-disclosing. Search strategy controls (FR-11-13) incl. generated-term disable and expandedFrom transparency. Frontend: landing, sign-in (Suspense-wrapped two-step redemption), closure page, full dashboard component.

**Verified:** vitest 15 files ALL PASSING incl. dashboard suite (cross-account denial over the entire new surface, not-interested exclusion, disclosure gate before/after ack, closure happy path + reuse + stale-token + no-confirm cases + immediate 401, partial-status exposure, strategy round-trip). Frontend lint+build clean. Live stack rebuilt healthy; dashboard/signin served 200 through Caddy.

**Deviations surfaced:** none architectural. Note: evaluations supersession remains derived (no mutation of append-only rows).

**Next step:** Phase 8 (T8.1-T8.5): operations - logging minimization, health/alerts, encrypted backups, restore drill runbook, retention enforcement.

## 2026-08-23 - CI fix: Phase 5/6 identity-job failures

**Done:** Diagnosed GitHub Actions failures on Phase 5/6 commits (only the identity/vitest job failed). Reproduced in a Linux container against a fresh Postgres: 5 unhandled rejections from maybeCompleteRun querying pgboss.job - delivery-machinery state used for domain completion and absent in CI. Fixed by migration 0006 (discovery_runs.targeted_sources) + checkAndCompleteRun: run completion now derives from authoritative attempt records vs declared targets, awaited inside the handler with failures contained. Regression test added (auto-complete on terminal attempts -> partial). Also restored local node_modules clobbered by an npm ci inside a mounted container (lesson recorded: isolate with named volumes).

**Verified:** Full suite re-run in CI-replica environment (node:22-alpine + postgres:17-alpine, fresh DB): 14 files / 131 tests passed with zero unhandled errors. Local lint+typecheck clean.

**Next step:** Confirm green CI run for this commit; then Phase 7.

## 2026-08-23 - Phase 6 (T6.1-T6.5) implemented and verified

**Done:** Hybrid evaluation capability under apps/backend/src/evaluation: PURE deterministic hard-constraint engine (remote_only/locations/excluded_companies/salary_floor per FR-6/7; unknowns retained+labeled+penalized; description text never an input so adversarial claims cannot flip rejections). Named-dimension scoring with default weights, simple higher/lower priorities, transparent enumerated penalties, ineligible scores capped <=25 (FR-21). Evidence-linked explanation validator (refs must exist in the job's named-field evidence set; requirement claims without evidence rejected). Immutable evaluation snapshots on the append-only table with supersession DERIVED (no mutation) and ADR-040 compatible-current selection (profile+policy+observation inputs must all match current, else null/pending). Bounded re-evaluation selector limited to active, non-dismissed, already-evaluated jobs. Engine composes stages; optional AI proposals minimized + validated, malformed/unavailable degrades to deterministic-only.

**Verified:** vitest 14 files ALL PASSING incl. new evaluation suite covering every T6.x AC (adversarial-text non-influence, FR-7 salary semantics, priority weight shifts, penalty enumeration, evidence-ref fabrication rejection, snapshot supersession attribution, incompatible-input nulls, bounded re-eval exclusions). Backend lint+typecheck clean.

**Deviations surfaced:** none architectural. Design note recorded: evaluations.superseded boolean column is retained but unused - supersession is derived from newer snapshots because append-only rows are never mutated (invariant 7).

**Next step:** Phase 7 (T7.1-T7.6): Next.js dashboard.

## 2026-08-23 - Phase 5 (T5.1-T5.7) implemented and verified

**Done:** pg-boss 10 integrated (work/boss.ts: queue registry extraction/collection/normalization/canonicalization/analysis/evaluation/availability; ENQUEUE_POLICY bounded transient-only retry at send time). Discovery orchestrator: per-account advisory-lock-serialized intake, manual ~6h refresh guardrail with truthful nextEligibleAt rejection, coalescing into the single queued follow-up (ADR-042), supersession to latest approved profile at run start, suspension/closure stops pending runs, complete/partial/failed aggregation from attempt outcomes (ADR-043). Collection work unit with idempotency identity collection:{runId}:{source}, attempt records, enable/terms gating, outcome mapping per ADR-044 (non-transient and rate-limited terminal; transient rethrown for bounded retry). Time-zone daily scheduling helpers (FR-8). Worker role now boots pg-boss and registers handlers. Routes: manual refresh + truthful status.

**Verified:** vitest 13 files / ALL PASSING incl. new discovery + collection suites covering every T5.x AC (two-time-zone scheduling, guardrail reject/coalesce, concurrent scheduled+manual+profile-change yielding <=1 follow-up, restart-mid-job exactly-once via idempotency identity, forced single-source failure -> partial with usable results, 401 source zero automatic retries, suspension mid-queue defers with no new results, real pg-boss delivery e2e). Live compose stack rebuilt: all healthy, migrations 0001-0005 applied, worker_ready logged.

**Deviations surfaced:** one SCHEMA CORRECTION required and applied in migration 0005: the Phase-1 partial unique index treated a queued follow-up as an active run, making coalescing impossible; replaced with at-most-one-RUNNING + at-most-one-QUEUED indexes. This implements ADR-042 as accepted rather than changing it.

**Next step:** Phase 6 (T6.1-T6.5): hybrid evaluation.

## 2026-08-23 - Phase 4 (T4.0-T4.6) implemented and verified

**Done:** T4.0 precondition executed: current-API-terms validated and recorded for greenhouse/lever/remoteok in docs/dev/source-terms.md + job_sources columns via migration 0004 (RemoteOK binding obligations: attribution + direct link back, stored as observation restrictions). Adapter layer: PoliteClient (~1 req/s sustained rate, <=3 attempts per ADR-044 with Retry-After honored/capped, non-transient failures never retried, injectable transport+clock), page-budget pagination helper, three adapters emitting contract observations with provenance/restrictions, registry gating collection on enabled+terms-validated BEFORE any request. Pipeline: normalization validation with recorded rejections; idempotent observation persistence scoped to run+hash+signal with initial/material/non_material classification; conservative canonicalization on strong company|title|location key (ambiguous -> separate candidate); non-destructive merge reconciliation records preserving historical evaluations; evidence-weighted availability (explicit signals only, absence never marks unavailable, freshness windows -> stale/uncertain, restored transitions); employer-ATS-preferred link selection.

**Verified:** vitest 11 files / 97 tests ALL PASSING, covering every T4.x AC: disable test shows zero requests, terms gate blocks unvalidated sources, rate/page-budget/Retry-After/non-retry assertions, malformed observation rejection with audit record, cross-source canonical convergence vs separation, merge preserves evaluation identity, all four availability states + restore, non-material change produces no material trigger.

**Deviations surfaced:** none architectural. Defects found by tests: duplicate-suppression wrongly swallowed fresh observations across runs / ignored availability signal - dedupe now scoped to same run+hash+signal; resetDb now also truncates shared job tables; restored-transition reason semantics fixed.

**Next step:** Phase 5 (T5.1-T5.7): pg-boss durable background work with approved policies.

## 2026-08-23 - Phase 3 (T3.1-T3.4) implemented and verified

**Done:** Resume intake via short-lived single-use scoped grants (migration 0003 resume_upload_grants; type/size allowlist; metadata-only rows with SHA-256; internal random storage keys). Extraction pipeline per ADR-054: deterministic redaction + assertMinimized post-condition before any provider payload; strict Node-side proposal validation (unknown fields rejected, nothing persisted on malformed output); idempotent work unit via idempotency_records. Draft workflow: edit-while-ready / accept creates immutable linked profile version / discard; manual completion path without resume. Profile versions: numbered immutable snapshots (ADR-005), current-profile resolution, hard-constraint/preference classification with mandatory strict toggles. FastAPI /extract endpoint (Gemini call behind key file, raw untrusted proposal passthrough). Routes ownership-guarded under requireSelf.

**Precondition executed:** Gemini unpaid-tier terms verified against ADR-060 - MATCH (recorded in current-state.md with two operational notes: EEA/CH/UK paid-tier data terms apply automatically; API keys must be restricted since 2026-06-19).

**Verified:** vitest 9 files ALL PASSING (Phase 2's 48 tests plus new storage/extraction/profile-drafts suites covering every T3.x AC incl. identifier-redaction proof of provider payloads); backend lint+typecheck clean; FastAPI ruff+import smoke OK.

**Deviations surfaced:** (1) Production S3-compatible object-store driver deferred to Phase 8 wiring - no OCI tenancy or credentials exist yet; dev/tests use an InMemoryObjectStore behind the same interface. No new container/service added to the approved Compose baseline. Flag for decision maker if earlier wiring is desired. (2) Extraction runs synchronously post-upload as the idempotent work unit until pg-boss durable delivery lands in T5.1 (per plan sequencing).

**Next step:** Phase 4 (T4.0 terms validations first, then adapters and shared job pipeline).

## 2026-08-23 - Phase 2 (T2.1-T2.6) implemented and verified

**Done:** Identity capability in apps/backend/src/identity: invitation lifecycle (issue/revoke/accept/lazy-expire, 14-day validity, activation creates account), passwordless sign-in links (opaque hash-only tokens, 15-min TTL, confirmation-before-redemption two-step, single-use, rate limits 3/15min + 10/24h per email, prior-unused invalidation, non-disclosing failures everywhere), sessions (user 30d/7d, admin 12h/1h, idle refresh, immediate revocation on suspension/closure/admin-removal), account state machine (closure terminal; failure audits persisted outside rolled-back transactions), dual-controlled admin role changes (self-approval refused+audited, last-admin guard, bootstrap procedure ops/bootstrap-admin.md), deny-by-default middleware with requireSelf ownership checks (404 for cross-account) over six user-scoped resource routes. Migration 0002_identity.sql adds accounts.is_admin + signin_links. 48 vitest integration tests in 6 suites; CI job 'identity' added.

**Verified:** npx vitest run: 6 files / 48 tests ALL PASSING against disposable careerpilot_test DB; backend lint+typecheck clean; full compose stack healthy after fixes.

**Deviations surfaced:** none architectural. Implementation defects found by tests and fixed: (a) setState COALESCE kept stale suspended_at/closed_at violating CHECK equality on transitions out of those states - timestamps now cleared explicitly; (b) invalid-transition audit events were written inside the aborted transaction and vanished - now recorded after rollback; (c) app rewrite had dropped /healthz + /readyz endpoints - restored. Test-side fixes: helper signature misuse, fixed-clock for HTTP tests, correct last-admin scenario construction.

**Next step:** Phase 3 (T3.1-T3.4). Before T3.2 AI work: verify current Gemini unpaid-tier terms vs ADR-060. T3.1 needs OCI Object Storage credentials.

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

---
---
---
---
---
---
---
