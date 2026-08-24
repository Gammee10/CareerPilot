# Current State

Last updated: 2026-08-23 (Phase 4 implementation session)

## Preconditions Status (recorded evidence)

1. **Gemini terms vs ADR-060: VERIFIED 2026-08-23, MATCH** (see Phase 3 entry).
2. **Source adapter terms (T4.0): RECORDED 2026-08-23** â€” `docs/dev/source-terms.md` + `job_sources.terms_validation_*` set by migration 0004 for greenhouse/lever/remoteok. Key obligations: RemoteOK requires source attribution + DIRECT link back (stored as `remoteok_attribution_direct_link` restriction on every observation; display surfaces must render it before beta launch); Lever/Greenhouse public reads are unrestricted but conservatively rate-limited (~1 req/s) by our client.


## Phase 5 Implementation Map

- `db/migrations/0005_work.sql` — accounts.timezone; REPLACED the Phase-1 one-active-run partial index (it made queued follow-ups impossible) with two indexes: at most one RUNNING + at most one QUEUED per user (ADR-042 corrected).
- `work/boss.ts` — pg-boss factory + queue registry (extraction, collection, normalization, canonicalization, analysis, evaluation, availability) + ENQUEUE_POLICY (bounded transient-only retry applied at send time).
- `discovery/orchestrator.ts` — requestDiscoveryRun (per-account advisory-lock-serialized intake; manual ~6h guardrail; coalescing into the single queued follow-up; account-inactive refusal), startQueuedRun (supersession to latest profile at start, suspension stops pending runs), completeRunFromAttempts (truthful complete/partial/failed aggregation), isDueForScheduledRun/localWallClock (time-zone daily scheduling, FR-8).
- `discovery/collection.ts` — collection work unit: run+account guards, enable/terms gate, idempotency identity collection:{runId}:{source}, attempt records, observation persistence + availability refresh, outcome mapping (non-transient/rate-limited terminal; transient rethrown for bounded pg-boss retry), truthful run completion.
- `worker/index.ts` — real worker role: starts pg-boss, registers extraction + collection handlers.
- Routes: POST /api/account/:id/discovery/refresh (manual guardrails surfaced truthfully incl. nextEligibleAt), GET /api/account/:id/discovery/status.
## Phase 4 Implementation Map

- `db/migrations/0004_sources.sql` â€” change_classification column, strong_match_key + index, T4.0 validation records.
- `sources/contract.ts` â€” observation contract + `validateSourceObservation` (normalization-stage validation, ADR-012) + `materialFingerprint` (hash over material fields only).
- `sources/politeClient.ts` â€” PoliteClient: sustained ~1 req/s rate, â‰¤3 attempts (ADR-044), Retry-After honored (capped), non-transient failures never retried; `collectPages` page-budget helper.
- `sources/adapters.ts` â€” greenhouse/lever/remoteok adapters emitting provenance-preserving observations; RemoteOK skips legal element, stores direct-link obligation.
- `sources/registry.ts` â€” buildAdapter + checkCollectionAllowed (unknown/disabled/terms-not-validated gates BEFORE any request; independently disableable).
- `sources/pipeline.ts` â€” persistObservation (normalize â†’ listing identity upsert â†’ duplicate guard scoped to same run+hash+signal â†’ classification initial/material/non_material â†’ derived current-view update only on material); ensureCanonicalJob (strong key company|title|location; ambiguousâ†’separate candidate, ADR-006); recordMerge (non-destructive reconciliation, evaluations untouched); computeAvailabilityState/refreshAvailability (explicit signals only, freshness windows per source, history rows on transitions only).
- `sources/links.ts` â€” selectApplicationLinks (employer ATS preferred, alternatives retained).

## Phase 3 Implementation Map

- `db/migrations/0003_profile.sql` â€” resume_upload_grants (short-lived single-use scoped upload/download authorizations).
- `storage/objectStore.ts` â€” ObjectStore interface; InMemoryObjectStore for dev/tests; S3-compatible production driver deferred to Phase 8 wiring with real OCI tenancy + file-mounted credentials (surfaced to decision maker â€” no new container added).
- `profile/resumes.ts` â€” grant creation/claiming (atomic single-use), type/size allowlist (text/pdf/docx â‰¤10MB), metadata-only DB rows, SHA-256, internal random storage keys never exposed.
- `profile/minimization.ts` â€” deterministic redaction (emails, phones, URLs, filenames, UUIDs, known names/account ids) + assertMinimized post-condition before any provider payload is built.
- `profile/extraction.ts` â€” idempotent work unit (`extraction:{docId}:{hash}` in idempotency_records); text-only extraction; AI failure/malformed output â†’ truthful failure, nothing persisted. Interim direct invocation post-upload; pg-boss delivery arrives T5.1.
- `profile/proposal.ts` â€” strict Node-side proposal validation (unknown fields rejected).
- `profile/drafts.ts` â€” edit (ready-only, revalidated) / accept (creates immutable version + links draft) / discard; manual path needs no resume.
- `profile/profileVersions.ts` â€” numbered immutable snapshots, current-profile resolution, hard-constraint/preference classification validation with strict-toggle rule.
- FastAPI `/extract` endpoint: receives only minimized task content, calls Gemini when key file present, returns raw untrusted proposal (validation is Node-side); no request/response content logged.

## CI

`.github/workflows/ci.yml`: backend lint+typecheck; frontend lint+typecheck+build; ai ruff+import smoke; identity/profile integration tests (Postgres service container); compose config validation + schema tests.

## Phase 2 Implementation Map (all under apps/backend/src)

- `identity/tokens.ts` â€” opaque base64url tokens, SHA-256 hash-only persistence.
- `identity/invitations.ts` â€” issue/revoke/accept/lazy-expire (14-day validity); acceptance creates the account (activation) and is idempotent per ADR-025.
- `identity/signinLinks.ts` â€” request (rate limits 3/15min + 10/24h per email, prior-unused invalidation), confirm (non-consuming), redeem (single-use, 15-min TTL, requires prior confirmation). All failures non-disclosing.
- `identity/sessions.ts` â€” user 30d absolute/7d idle; admin 12h/1h; idle refresh on validation; revocation on suspension/closure/admin-authority removal.
- `identity/accounts.ts` â€” active<->suspended<->closed state machine, closure terminal, timestamps cleared on transitions, failure audits persisted outside aborted transactions.
- `identity/adminRoles.ts` â€” dual-control initiate/approve; self-approval refused+audited; last-admin guard; executed revoke strips privileged sessions immediately.
- `middleware/auth.ts` â€” deny-by-default requireSession / requireAdmin / requireSelf (404 for cross-account to avoid existence disclosure).
- `app.ts` â€” route surface: public auth endpoints, `/api/me`, six user-scoped resource routes (ownership-guarded placeholders for later phases), admin invitation/account/role-change routes. Bootstrap procedure: `ops/bootstrap-admin.md` + `scripts/bootstrap-admin.sql` (audit-recorded).
- Tests: `apps/backend/test/*.test.ts` (vitest, 48 tests) against disposable `careerpilot_test` DB; CI job `identity`.

## Phase Status

| Phase | Status |
|---|---|
| 1 â€” Foundation | Complete (T1.1â€“T1.4 verified; see session log) |
| 2 â€” Identity, Invitations, Sessions | Complete (T2.1â€“T2.6 implemented; 48 vitest integration tests passing) |
| 3 â€” Profile and Resume Processing | Not started |
| 4 â€” Source Adapters and Shared Job Pipeline | Not started (T4.0 terms validation is a blocking precondition) |
| 5 â€” Discovery Orchestration and Background Work | Not started |
| 6 â€” Hybrid Evaluation | Not started |
| 7 â€” Dashboard | Not started |
| 8 â€” Operations | Not started |
| 9 â€” Release-Validation Gate | Not started |

## Repository State

Git repo initialized on `main`; pushed to https://github.com/Gammee10/CareerPilot.git.

Key paths:
- `compose.yaml` (+ `compose.override.yaml` local debug binds, `compose.prod.yaml` VM overrides) â€” five services + Caddy; only Caddy publishes host ports; `edge`/`core` networks separate public from private services.
- `db/migrations/0001_init.sql` â€” full domain-model schema. Append-only tables (`profile_versions`, `evaluations`, `source_listing_observations`, `availability_history`, `audit_events`) enforced by `forbid_mutation()` trigger: UPDATE always rejected; DELETE only when the transaction sets `app.retention_sweep = 'on'` (retention sweeps, ADRs 020/021).
- `db/tests/schema-tests.sql` + `scripts/test-schema.ps1` / `.sh` â€” schema test suite.
- `apps/backend` (Express+TS server, worker role stub, SQL migration runner), `apps/frontend` (Next.js shell), `services/ai` (FastAPI shell).
- `secrets/README.md`, `scripts/dev-secrets.*`, `scripts/fetch-vault-secrets.sh`, `docs/dev/secrets.md` â€” secrets wiring.
- `docs/dev/local-dev.md`, root `README.md` â€” one-command startup.

## Running State

Local stack runs healthy via `powershell -File scripts/dev-up.ps1`
(`docker compose up -d --build --wait`). Entry point http://localhost:8080;
`/api/healthz`, `/api/readyz` live through Caddy.

## Verification Evidence (Phase 1)

- T1.1: all six containers report healthy under `docker compose ps`;
  routing checks: `/api/healthz` â†’ backend ok, `/api/readyz` â†’ DB-ready,
  `/` â†’ dashboard 200 via Caddy.
- T1.2: `scripts/test-schema.ps1` â†’ ALL SCHEMA TESTS PASSED (append-only
  UPDATE/DELETE rejection, retention-sweep delete + rollback restore,
  lifecycle/governance constraints incl. no-self-approval, one-active-run
  coalescing index, observation idempotency with NULLS NOT DISTINCT).
- T1.3: grep secret-scan clean; container env scan clean; frontend has zero
  secret mounts; postgres initialized from `POSTGRES_PASSWORD_FILE`; backend
  reads the same mounted password (readyz proves it).
- T1.4: fresh-clone flow exercised end to end (dev-up creates `.env`,
  generates local-only secrets, builds, migrates, waits healthy).

## Blocking Preconditions (unchanged, not yet due)

1. Gemini unpaid-tier terms verification vs ADR-060 â€” required before any AI feature (Phase 6/3 extraction).
2. Per-adapter current-API-terms validation records (T4.0) â€” required before first adapter use (Phase 4).

## OPEN Items Surfaced During Implementation

(none outstanding)

## Environment Notes

- Dev machine: Windows 11, PowerShell; Docker Desktop 29.x installed this
  session (required elevated WSL2 install + reboot).
- Production Caddyfile variant: `caddy/Caddyfile.production`, applied with
  `docker compose -f compose.yaml -f compose.prod.yaml up -d` on the VM.

## Next Step

Phase 6 (T6.1-T6.5): deterministic hard constraints first, AI-assisted interpretation behind ADR-054 minimization with Node-side validation, dimension scores + evidence-linked explanations, immutable evaluation snapshots with compatible-current-result selection, bounded re-evaluation after material profile change.
