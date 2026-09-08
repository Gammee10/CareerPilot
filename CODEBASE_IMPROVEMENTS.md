# CareerPilot — Codebase Improvement Audit

Date: 2026-09-07. Scope: entire repository as of gate-APPROVED MVP (all 9 phases).
Method: full file inventory + line-level review of `apps/backend/src`, `apps/frontend`,
`services/ai`, `db/migrations`, `ops/`, `scripts/`, `caddy/`, `.github/workflows`,
plus test suites. Findings are evidence-based; items that could not be fully verified
are labeled **(Needs verification)**.

## Executive Summary

| Severity | Count |
|---|---|
| Critical | 8 |
| High | 16 |
| Medium | 14 |
| Low | 8 |
| Optional | 5 |
| **Total** | **51** |

Most important areas requiring attention:

1. **Authentication/authorization correctness** — the admin session role is never issued
   (admin surface dead), plus two IDOR-class gaps (extraction, job detail) and an
   unevaluated evaluate endpoint. Fix before any onboarding.
2. **AI capability is an open proxy** — `POST /extract` has no caller authentication,
   unbounded input, and no defense-in-depth minimization. Any network reachability
   beyond Compose internals turns it into a quota-burning oracle.
3. **Production email is a stub** — `LoggingMailer` is wired in `server.ts`, so
   invitation/sign-in/closure links only hit `console.log`. All passwordless flows
   are broken in prod until Resend is wired.
4. **Source-collection pacing is a no-op** — the sleep hook is stubbed out, so the
   ADR-059 ~1 req/s pacing never delays. Tight loops can hammer Greenhouse/Lever/
   RemoteOK and violate the terms validations recorded in T4.0.
5. **Retention/deletion pipeline has gaps** — the resume-grace writer
   (`superseded_at`) is never set so raw objects are retained indefinitely; artifact
   bytes are never deleted by the sweep; shared-observation deletes can orphan
   evaluations; the backup cipher is non-authenticated CBC and the bucket object is
   never re-verified after upload.
6. **Data-correctness risk in evaluation/dashboard** — `loadJobView` picks an
   arbitrary listing and disagrees with snapshot input selection, which can leave
   the dashboard permanently `pendingReevaluation`; `targeted_sources` is never
   populated so auto-complete is dead; several check-then-insert races
   (extraction idempotency, version numbering, canonicalization) can create
   duplicates under concurrency.
7. **Deployment/observability hardening** — no security headers, no HTTP rate
   limiting, token-bearing URLs captured by default access logs, no resource limits
   or log rotation on the single Always Free VM, CI missing secrets/dependency
   scanning and prod image builds, frontend with zero tests and an unsafe-URL
   (`javascript:`) link sink.

---

## Critical

### C1. Admin sessions are never issued — entire admin surface returns 403

- **Category:** Authentication / Authorization
- **Severity:** Critical
- **Location:** `apps/backend/src/middleware/auth.ts:63-69`; `apps/backend/src/app.ts:152,165`
  (signin-link redeem, invitation redeem call `createSession(db, id, "user", …)`)
- **Current problem:** `requireAdmin` requires `isAdminAccount && role === "admin"`,
  but no code path ever creates a session with `role='admin'`. Every `/api/admin/*`
  route therefore returns 403 even for legitimate admins. Admin invitation, account
  suspension/closure-by-admin, and role-change approval flows are dead in practice.
- **Recommended improvement:** Decide one canonical admin-session issuance rule
  (e.g., if `accounts.is_admin` at redeem time, issue `role='admin'`; or add an
  explicit admin step-up endpoint) and implement it in both redeem paths.
- **Implementation guidance:**
  1. Read `identity/sessions.ts` `createSession` signature and `identity/adminRoles.ts`.
  2. Patch both redeem handlers in `app.ts` to select role from the freshly-read
     `is_admin` flag inside the same transaction that validates the link.
  3. Add a test: admin account redeems link → `requireAdmin` passes; non-admin → 403.
  4. Confirm no privilege-escalation path: role must derive server-side from
     `accounts.is_admin`, never from request input.
- **Suggested validation:** New vitest integration test over the HTTP surface
  (`POST /api/admin/*` with admin vs non-admin cookies); existing 48 identity tests
  must still pass.
- **Status: Completed 2026-09-07** — both redeem paths derive `role` server-side
  from `accounts.is_admin`; test covers admin redeem → 200 on `/api/admin/*`
  and non-admin redeem → 403.

### C2. AI `/extract` endpoint has zero caller authentication (open Gemini proxy)

- **Category:** Security / API
- **Severity:** Critical
- **Location:** `services/ai/main.py:82-85`
- **Current problem:** `POST /extract` accepts any caller with no bearer token, mTLS,
  or ingress check. The comment says "Node-owned path" but nothing enforces it. If
  the container is reachable beyond the Compose `core` network it becomes an open
  proxy that burns Gemini quota and accepts attacker-controlled content.
- **Recommended improvement:** Require a shared secret (file-mounted, like other
  secrets) on every `/extract` call; reject with 401 otherwise. Belt-and-braces:
  keep the service off the `edge` network (verify `compose.yaml`) and document that
  Caddy must never route to it.
- **Implementation guidance:**
  1. Add `AI_INTERNAL_TOKEN_FILE` env + `readSecret`-style file read in `main.py`;
     add a FastAPI dependency that compares with `hmac.compare_digest` against
     `Authorization: Bearer <token>`.
  2. Add the same token file as a Compose secret mounted into `backend` and `ai`;
     send the header from `profile/aiClient.ts`.
  3. Add `max_length` on `ExtractionRequest.content` (see H-finding) at the same time.
- **Suggested validation:** pytest: no-token → 401, wrong-token → 401, correct → 200;
  manual `docker compose config` confirms `ai` has no `edge` network or published port.
- **Status: Completed 2026-09-07** — shared file-mounted `ai_internal_token` enforced via
  `hmac.compare_digest` on `/extract`, `HttpAiClient` sends the bearer header,
  `content max_length=50000`, compose mounts token into backend/worker/ai (ai stays
  `core`-only), dev/vault secret scripts generate/retrieve it, pytest
  `test_extract_auth.py` covers 401/200/422.

### C3. Production mailer is a logging stub — passwordless flows never deliver

- **Category:** Reliability / Authentication
- **Severity:** Critical
- **Location:** `apps/backend/src/server.ts:6` (`new LoggingMailer()`); `apps/backend/src/notify/mailer.ts`
- **Current problem:** Invitation, sign-in, and closure emails are only
  `console.log`'d. Users never receive links, so invite-only onboarding and all
  passwordless sign-in are broken in any deployed environment until Resend is wired.
- **Recommended improvement:** Implement the Resend mailer behind the existing
  `Mailer` interface and wire it in `server.ts` when `RESEND_API_KEY_FILE` is present
  (keep `LoggingMailer` for dev/test injection only).
- **Implementation guidance:**
  1. Add `ResendMailer implements Mailer` using the Resend HTTP API with the key
     read from file (never from env value); timeout + 1 bounded retry on 5xx/429 only.
  2. In `server.ts`, select mailer by presence of the key file; fail boot with an
     operational message if `NODE_ENV=production` and the file is missing.
  3. Keep `AppDeps.mailer` injection so tests still use the capture/logging double.
- **Suggested validation:** Integration test with a stubbed fetch asserting send on
  invite + sign-in request; manual dev check that no real email fires locally.
- **Status: Completed 2026-09-07** — `ResendMailer` implements `Mailer` over the
  Resend HTTP API (key from file-mounted secret only, `EMAIL_FROM` sender,
  10s timeout, one bounded retry on 429/5xx, minimized failure logs);
  `server.ts` selects Resend when the key file exists and refuses to boot in
  production when missing; `test/mailer.test.ts` covers send/retry/no-retry.

### C4. Extraction endpoint is IDOR-vulnerable (no document-ownership check)

- **Category:** Authorization
- **Severity:** Critical
- **Location:** `apps/backend/src/profile/extraction.ts:16-32`; `apps/backend/src/app.ts:418-440`
- **Current problem:** `runExtraction` takes only `resumeDocumentId`, never
  `accountId`. The route is `requireSelf(:accountId)` but never verifies the document
  belongs to that account. User A can trigger extraction on user B's document, burn
  AI budget on victim data, and receive a `draftId`.
- **Recommended improvement:** Pass `accountId` into `runExtraction` and constrain
  every query with `WHERE id = $1 AND account_id = $2`; return 404 on mismatch.
- **Implementation guidance:**
  1. Change signature to `runExtraction(db, store, ai, accountId, resumeDocumentId, …)`.
  2. Update the route call site; add a cross-account test (A's doc + B's session → 404,
     no AI call).
- **Suggested validation:** New authorization test asserting 404 + zero AI invocations
  on cross-account extraction; run `authorization.test.ts`.
- **Status: Completed 2026-09-07** — `runExtraction` now takes `accountId` and
  constrains the document lookup with `AND account_id = $2` (non-disclosing
  `document_not_found`); upload route passes the grant-derived owner, extract
  route passes the session account, worker payload carries `accountId`;
  `completeUpload` returns the owner; unit + HTTP cross-account tests added.

### C5. Job detail endpoint has no ownership/evaluation check (enumerable by UUID)

- **Category:** Authorization
- **Severity:** Critical
- **Location:** `apps/backend/src/dashboard/jobs.ts:91-160`
- **Current problem:** `getJobDetail(accountId, canonicalJobId)` never verifies the
  caller has any evaluation/review row for that job. Any authenticated user can fetch
  facts, URLs, and restrictions for arbitrary canonical-job UUIDs by guessing.
- **Recommended improvement:** Require an `evaluations` or `job_reviews` row for
  `(accountId, jobId)`; otherwise return a non-disclosing 404.
- **Implementation guidance:** Add an existence check at the top of `getJobDetail`
  (single `SELECT 1 … WHERE account_id AND canonical_job_id`); index already exists
  via evaluations table — verify. Add cross-account detail test.
- **Suggested validation:** Cross-account test: B fetches A's unevaluated job → 404.
- **Status: Completed 2026-09-07** — `getJobDetail` requires an `evaluations`
  or `user_job_reviews` row for `(accountId, jobId)` first, else non-disclosing
  null (route → 404); owner path unaffected; cross-account detail test added.

### C6. Source-collection pacing is a no-op (rate limit never actually waits)

- **Category:** Reliability / Performance / Privacy (terms compliance)
- **Severity:** Critical
- **Location:** `apps/backend/src/discovery/collection.ts:116-122`
  (`sleep: async () => undefined`); `apps/backend/src/sources/politeClient.ts:52-54`
- **Current problem:** `PoliteClient` computes `earliest > nowMs` then awaits a no-op,
  so the ADR-059 ~1 req/s pacing never delays. Collection tight-loops against
  Greenhouse/Lever/RemoteOK, risking IP blocks and violating the conservative
  rate-limit obligations recorded in `docs/dev/source-terms.md`.
- **Recommended improvement:** Inject a real sleep (`setTimeout`) in production;
  keep the no-op only in tests via explicit DI.
- **Implementation guidance:**
  1. Default `sleep` to `(ms) => new Promise(r => setTimeout(r, ms))` in
     `collection.ts`; tests pass the no-op explicitly.
  2. Add a test with a fake clock asserting ≥2 sequential source calls are spaced
     by the configured interval.
  3. Confirm `Retry-After` path (politeClient) actually awaits the injected sleep.
- **Suggested validation:** Unit test on spacing; manual log-timing check on a real
  collection run.
- **Status: Completed 2026-09-07** — `CollectionDeps.sleep` defaults to a real
  `setTimeout` timer (production pacing actually waits); tests inject an
  explicit no-op; new fake-clock tests assert sequential calls are spaced by
  the interval and `Retry-After` is honored through the injected sleep.

### C7. Resume-grace retention never fires; artifact bytes never swept (ADR-020 gap)

- **Category:** Privacy / Database / Reliability
- **Severity:** Critical
- **Location:** `apps/backend/src/observability/retention.ts:36-82`; no writer of
  `resume_documents.superseded_at` anywhere in `src`
- **Current problem:** The 30-day raw-resume grace UPDATE matches on
  `superseded_at`, which nothing ever sets — so the sweep is a permanent no-op and
  raw objects are retained indefinitely. Object bytes themselves are never deleted
  here (relies on an unwired "artifact sweeper"). This violates the ADR-020 schedule
  and grows storage without bound.
- **Recommended improvement:** Add the missing lifecycle writer (set
  `superseded_at` when a draft is accepted/superseded or after the grace trigger)
  and an artifact sweeper that deletes object-store bytes for swept rows.
- **Implementation guidance:**
  1. Grep all resume accept/discard paths; set `superseded_at = now()` at the
     correct transition (confirm against `docs/domain-model.md` + ADR-020).
  2. Extend `runRetentionSweep` (or a follow-up step in the same tx) to list swept
     storage keys and `store.delete()` them; log only counts.
  3. Migration considerations: none (column exists); backfill existing stale rows
     with a one-off sweep query reviewed against the retention schedule.
- **Suggested validation:** Retention tests: accepted resume older than 30d →
  row soft-deleted + object deleted; fresh rows untouched.
- **Status: Completed 2026-09-07** — `completeUpload` marks all prior account
  raws `superseded_at` in the same tx (replacement starts the grace; fresh doc
  stays current, so no backfill needed); `runRetentionSweep(db, now, store?)`
  deletes object bytes for newly swept rows (`RETURNING storage_key`,
  counts-only telemetry, `resumeArtifactsDeleted` in results); writer + sweeper
  tests added.

### C8. Shared-observation delete can orphan evaluations / break latest-hash chains

- **Category:** Database / Reliability
- **Severity:** Critical
- **Location:** `apps/backend/src/observability/retention.ts` (180-day shared delete);
  `db/migrations/0001_init.sql` (evaluations → observations FK)
- **Current problem:** The 180-day sweep can delete the *latest* observation for a
  listing, breaking `latest_hash` chains and leaving
  `evaluations.input_observation_id` dangling (FK failure or orphan depending on
  constraint behavior). Historical evaluation evidence required by ADR-037 must not
  be destroyed by a time-based sweep.
- **Recommended improvement:** Never delete observations referenced by evaluations
  or that are the current latest for a live listing; delete only superseded,
  unreferenced rows (or null-safe archive first).
- **Implementation guidance:**
  1. Add `WHERE NOT EXISTS (SELECT 1 FROM evaluations WHERE input_observation_id = …)`
     and `… != latest observation per listing` guards.
  2. Verify FK is `ON DELETE RESTRICT`; add a test with a referenced old observation
     (must survive) vs unreferenced old observation (may be swept).
- **Suggested validation:** Retention test covering both cases; schema test for the
  FK behavior.
- **Status: Completed 2026-09-07** — the 180-day observation sweep now skips
  rows referenced by `evaluations.input_observation_id` and each listing's
  current latest observation (`observed_at DESC, id DESC`); verified the FK
  carries no `ON DELETE` action (default NO ACTION = restrict-equivalent
  backstop). Test covers referenced-survives / latest-survives /
  unreferenced-non-latest-swept.

---

## High

### H1. `evaluateJobForUser` has no account/active check and burns AI budget

- **Category:** Authorization / API
- **Severity:** High
- **Location:** `apps/backend/src/evaluation/engine.ts:22-30`
- **Current problem:** Any authenticated user can evaluate any canonical job with no
  account-state check, no job-ownership scoping, and no rate limit — each call can
  trigger an AI request and create snapshots for arbitrary jobs.
- **Recommended improvement:** Verify `accounts.state === 'active'`, scope the job
  to the caller's evaluated set, and add a per-account evaluation rate limit.
- **Implementation guidance:** Add the account lookup + 404/403 at the top of the
  engine entry; thread `accountId` from the route (already `requireSelf`).
- **Suggested validation:** Auth test: suspended account → refused with no AI call;
  cross-account job → 404.
- **Status: Completed 2026-09-07** — engine verifies `accounts.state='active'`
  first (`account_inactive`, no AI spend) and enforces a 30/hour per-account
  evaluation budget (`rate_limited`, route → 429 + Retry-After); route maps
  409/429/404 accordingly. Deliberate deviation: no pre-existing-evaluation
  scoping, since evaluating a new job is the endpoint's purpose — the budget
  bounds the AI-burn vector instead.

### H2. Bearer-token acceptance undermines the HttpOnly session cookie

- **Category:** Security / Authentication
- **Severity:** High
- **Location:** `apps/backend/src/middleware/auth.ts:23-34`
- **Current problem:** `extractSessionToken` accepts `Authorization: Bearer <session>`,
  encouraging session tokens in JS-accessible storage, logs, and proxies — defeating
  the HttpOnly cookie set in `app.ts:79-85`.
- **Recommended improvement:** Remove Bearer acceptance unless a concrete client
  needs it; if retained, scope it (e.g., separate API tokens), redact it from logs,
  and document the tradeoff.
- **Implementation guidance:** Delete the Bearer branch; grep callers/tests for
  Bearer usage and migrate them to cookies. If kept, add `redactAuthorization`
  in the logger.
- **Suggested validation:** Test that `Authorization` header alone no longer
  authenticates (or is explicitly scoped); manual header review.
- **Status: Completed 2026-09-07** — Bearer branch removed from
  `extractSessionToken`; HttpOnly cookie is the sole session credential
  (internal AI/Resend auth uses separate file-mounted secrets). Test asserts
  Bearer-alone → 401 while the same token as cookie → 200; no callers used
  Bearer (verified by grep over backend + frontend).

### H3. Non-atomic link redemption breaks retry (closure + sign-in)

- **Category:** Reliability
- **Severity:** High
- **Location:** `apps/backend/src/identity/closure.ts:105-133`;
  `apps/backend/src/identity/signinLinks.ts:134-185` + `app.ts:152`
- **Current problem:** Redeem UPDATE commits, *then* `closeAccount`/session-creation
  runs in a second transaction. A crash between them consumes a single-use link
  without closing the account (or without issuing a session), forcing the user to
  re-request with no recovery path.
- **Recommended improvement:** Make redeem + effect atomic (single tx) or add a
  compensating retry keyed by the link idempotency identity.
- **Implementation guidance:** Move `closeAccount`/`createSession` inside the redeem
  transaction; on failure roll back so the link remains redeemable. Add a crash-window
  test (mock failure between steps → link still valid).
- **Suggested validation:** Fault-injection test for both closure and sign-in paths.
- **Status: Completed 2026-09-07** — redeem + effect now share one transaction:
  sign-in link consume + session issue (role derived server-side inside the
  tx), closure consume + `closeAccount` via outer-client join, invitation
  accept + first session. Any failure rolls back so the link stays redeemable;
  suspend-then-redeem test proves link preservation + post-reactivation retry.

### H4. Check-then-insert races: extraction idempotency, version numbering, canonicalization

- **Category:** Concurrency / Database
- **Severity:** High
- **Location:** `apps/backend/src/profile/extraction.ts:59-117`;
  `apps/backend/src/profile/profileVersions.ts:88-98`; `apps/backend/src/profile/drafts.ts:93-103`;
  `apps/backend/src/sources/pipeline.ts:167-189`
- **Current problem:** SELECT-then-INSERT with no `ON CONFLICT` or advisory lock.
  Concurrent duplicates double-pay AI cost (extraction), produce duplicate
  `version_number` (profiles), or divergent `canonical_jobs` for identical
  `strong_match_key` (sources). The extraction reuse lookup also ignores the content
  hash, returning stale drafts for changed content.
- **Recommended improvement:** Add `ON CONFLICT DO NOTHING` + per-account/per-key
  `pg_advisory_xact_lock`, and include the content hash in the reuse lookup.
- **Implementation guidance:**
  1. Extraction: unique on idempotency key + `ON CONFLICT`; lock per
     `(docId, hash)`; reuse query must filter by hash.
  2. Versions: advisory lock per account around `MAX()+1`, or a per-account sequence.
  3. Canonical: unique constraint on `strong_match_key` (where not null) +
     `ON CONFLICT DO UPDATE/NOTHING`.
- **Suggested validation:** Concurrency tests (parallel duplicate calls → exactly one
  AI call / one version / one canonical row).
- **Status: Completed 2026-09-07** — advisory-lock serialization + hardened
  writes: extraction re-checks idempotency under `pg_advisory_xact_lock` with
  `ON CONFLICT DO NOTHING` (one draft per logical input; reuse key already
  binds doc+hash so changed content never hits stale drafts); profile saves
  lock per account with unique-violation retry; canonicalization locks per
  match key (no unique constraint, preserving ambiguous→separate semantics);
  accept/edit/discard use conditional updates + draft locks. Deliberate
  deviation: parallel duplicates may still double-pay one provider call (AI
  runs before the DB lock) — the guarantee is a single persisted outcome, and
  the test asserts one draft, not one AI call.

### H5. `targeted_sources` never populated — run auto-complete is dead code

- **Category:** Backend / Reliability
- **Severity:** High
- **Location:** `apps/backend/src/discovery/orchestrator.ts:201-206,374-396`;
  `db/migrations/0006_run_targets.sql:5` (default `'[]'`)
- **Current problem:** Intake INSERTs omit `targeted_sources`, so it stays `[]` and
  `checkAndCompleteRun` early-returns. Runs stay `running` unless some other driver
  completes them; `complete/partial/failed` truthfulness (ADR-043) depends on a path
  that never runs.
- **Recommended improvement:** Populate `targeted_sources` at intake from the
  enabled/allowed source set, or remove the dead auto-complete function if another
  completion path is canonical.
- **Implementation guidance:** Set the column in the intake INSERT; backfill existing
  `[]` rows from `source_collection_attempts` or mark unknown as NULL. Add a test:
  terminal attempts → run completes with correct status.
- **Suggested validation:** Discovery test asserting auto-complete on terminal attempts.
- **Status: Completed 2026-09-07** — intake records `targeted_sources` from the
  enabled + terms-validated adapter set (`listTargetedSources`, shared for the
  future fan-out driver; `url_import` excluded as user-driven); tests cover
  target declaration, terminal-attempt auto-complete, and disabled-source
  exclusion. No backfill needed (pre-onboarding; `[]` retains its
  driver-completes-explicitly meaning).

### H6. Dashboard list is N+1 with no pagination

- **Category:** Performance
- **Severity:** High
- **Location:** `apps/backend/src/dashboard/jobs.ts:34-66`
- **Current problem:** ~6 queries per job (availability + compatible evaluation +
  job view) with no LIMIT. 500 evaluated jobs ≈ 3000 roundtrips per page load —
  will time out on the single Always Free VM.
- **Recommended improvement:** Batch with joined queries (`DISTINCT ON` / lateral)
  and add cursor pagination (`LIMIT` + `OFFSET` or keyset).
- **Implementation guidance:** Rewrite `listJobsForDashboard` to fetch availability
  + latest compatible evaluations in two bulk queries keyed by job id; add
  `?limit=&cursor=` params with a conservative default (e.g., 50).
- **Suggested validation:** Load test with 500-job fixture asserting bounded query
  count (e.g., via pg query counter) and p95 < threshold.
- **Status: Completed 2026-09-07** — list rewritten to ~8 batched roundtrips
  (candidates, availability, profile, latest-observations, evaluations,
  listing facts + deterministic fallback) with identical ranking/filter/
  pending semantics, plus `limit` (default 50, max 200) / `offset` pagination
  in a `{jobs, total, limit, offset}` envelope (malformed values fall back to
  defaults, never 500). Drive-by fix: pg `numeric` scores are now serialized
  as JSON numbers, matching the frontend's `score: number | null` contract
  (was strings at runtime). Test: 12-job fixture pages 5/5/2 with disjoint ids
  and intact titles/eligibility. A 500-job load soak remains future work for
  the VM.

### H7. `loadJobView` selection disagrees with snapshot selection (dashboard stuck pending)

- **Category:** Backend / Data correctness
- **Severity:** High
- **Location:** `apps/backend/src/evaluation/jobFacts.ts:62-98`;
  `apps/backend/src/evaluation/snapshot.ts:88-97,118-120`
- **Current problem:** `loadJobView` picks `listings.rows[0]` with no ORDER BY
  (arbitrary), derives company from a title split (title fragment as employer →
  `excluded_companies` false positives/negatives), and picks a different "latest"
  observation than `snapshot.ts`. The two disagree, so
  `getCurrentCompatibleEvaluation` almost always returns null → dashboard shows
  `pendingReevaluation: true` forever with no scores.
- **Recommended improvement:** Single deterministic "current view" selector shared by
  both paths (e.g., latest observation by `(observed_at DESC, id DESC)` per listing,
  primary listing by explicit rule), and never infer company from title.
- **Implementation guidance:** Extract one `getCurrentJobView` module used by both
  `jobFacts` and `snapshot`; add ORDER BY everywhere; company falls back to null
  (unknown) rather than a title fragment.
- **Suggested validation:** Evaluation test: seed multi-listing job → both selectors
  agree; dashboard test shows scores instead of permanent pending.
- **Status: Completed 2026-09-07** — new `evaluation/currentView.ts`
  `getCurrentJobSelection` (global latest observation by `observed_at DESC,
  id DESC`) shared by `loadJobView` and `getCurrentCompatibleEvaluation`;
  primary listing is deterministic (selection's listing, ordered fallback);
  employer falls back to null instead of a title fragment. Test covers
  multi-listing agreement + immediate current result.

### H8. RemoteOK adapter crashes on unexpected shape; no response-size cap

- **Category:** Reliability / Security
- **Severity:** High
- **Location:** `apps/backend/src/sources/adapters.ts:148-151` (`data.slice(1)`);
  `apps/backend/src/discovery/collection.ts:35-47` (`await res.text()` unbounded);
  `apps/backend/src/sources/politeClient.ts:60` (unguarded `JSON.parse`)
- **Current problem:** Non-array RemoteOK body → TypeError → `unknown_error` →
  bounded retry storm for a non-transient shape error. Unbounded `res.text()` lets a
  large/compromised feed OOM the worker. Malformed-but-200 JSON wastes retry budget
  as "transient".
- **Recommended improvement:** Validate `Array.isArray` first and throw
  `NonTransientError` on shape mismatch; enforce a byte cap (e.g., 5 MB) with
  content-length pre-check; map JSON SyntaxError to non-transient.
- **Implementation guidance:** Guard in adapter + cap in collection fetcher; unit
  tests for object-body, empty-body, oversized-body, malformed-JSON cases.
- **Suggested validation:** Adapter tests for all four shapes; collection test with
  oversized fixture → clean terminal failure, no retry storm.
- **Status: Completed 2026-09-07** — RemoteOK non-array bodies throw terminal
  `NonTransientError` (no TypeError retry storm), non-object entries skipped;
  Greenhouse/Lever guard non-array payloads; 5 MB cap enforced in both the real
  fetcher (content-length pre-check + post-read check) and `PoliteClient`;
  malformed-but-200 JSON maps to terminal non-transient. Tests cover all four
  shapes + oversized collection (single attempt, `failed_non_transient`).

### H9. Token-bearing URLs are captured by default access logs (minimization hole)

- **Category:** Privacy / Security
- **Severity:** High
- **Location:** `caddy/Caddyfile`, `caddy/Caddyfile.production` (no `log` config);
  `apps/backend/src/app.ts:355,394` (grant tokens in path), sign-in/invitation/
  closure `?token=` links
- **Current problem:** Caddy's default access logs capture full URIs including
  grant tokens and single-use link tokens — the largest ADR-015 minimization hole.
  Path-segment bearer secrets also land in proxy logs, history, and `Referer`.
- **Recommended improvement:** Add Caddy `log_skip` / URI redaction for
  `/api/resume/*`, `/api/auth/*`, `/api/admin/*`, and move grant tokens from URL
  path to `Authorization` header or single-use body field.
- **Implementation guidance:** Caddy `log { skip_hosts … }` or per-handle `log_skip`;
  change grant endpoints to accept the token in header/body (keep path compat
  briefly if needed, then remove).
- **Suggested validation:** Manual log inspection after hitting each sensitive route;
  automated test asserting no token pattern in emitted access log fixture.
- **Status: Completed 2026-09-07** — grant tokens moved from URL path to the
  `X-Grant-Token` header (`PUT /api/resume/upload`, `GET /api/resume/download`;
  old path routes removed, no compat needed — no API consumers exist
  pre-onboarding); Caddy `log_skip` on the `?token=` frontend pages
  (`/signin*`, `/closure*`, `/activate*`), verified in the adapted JSON
  (`log_skip: true`) with both Caddyfiles passing `caddy validate`. Backend
  URIs now carry no bearer material at all (all link tokens travel in JSON
  bodies, which access logs never record), so `/api/*` access logging stays
  intact for ops forensics — a deliberate deviation from blanket-skipping the
  API prefixes, recorded here. Tests: header-only transport (path form 404s,
  headless 403s, grant unconsumed by failures).

### H10. No HTTP rate limiting, security headers, or hardening middleware

- **Category:** Security / DevOps
- **Severity:** High
- **Location:** `apps/backend/src/app.ts:93-94` (only `disable(x-powered-by)` +
  `express.json()`); both Caddyfiles (only `encode` + `reverse_proxy`);
  `apps/frontend/next.config.mjs` (`{}`)
- **Current problem:** No `helmet`, `hpp`, CORS lockdown, `express-rate-limit` on
  `/api/auth/*` and `/api/admin/*`, no Caddy `rate_limit`, no CSP/HSTS/
  `X-Content-Type-Options`/`Referrer-Policy`/`Permissions-Policy` anywhere. Only
  per-email DB link limits exist; IP-level brute force on link endpoints is
  unmitigated.
- **Recommended improvement:** Add `helmet` + auth-route rate limits (with
  `Retry-After` on 429) in Express, and security headers in Caddy (or Next
  `headers()`), with a documented exception list.
- **Implementation guidance:** `helmet()`, `hpp()`, explicit CORS allowlist (same
  origin by default), `express-rate-limit` on public auth routes; Caddy
  `header { Strict-Transport-Security …; X-Content-Type-Options nosniff; … }`.
- **Suggested validation:** HTTP tests asserting headers present, 429 after burst,
  CORS preflight denied cross-origin.
- **Status: Completed 2026-09-07** — `helmet()` (CSP `default-src 'none'` +
  `frame-ancestors 'none'`, `X-Frame-Options DENY`, CORP same-origin) +
  per-route IP rate limits on all six public link endpoints (30/min issuance,
  100/min confirm/redeem, 429 + `Retry-After: 60`) + `trust proxy loopback` so
  limits see the real client IP behind Caddy; `express.json({limit:'100kb'})`
  with 400 `invalid_json` / 413 `payload_too_large` mapping (never 500);
  Caddy edge headers in both Caddyfiles (HSTS only in production);
  Next `poweredByHeader:false` + document headers. Deliberate deviations: no
  `hpp` (no `req.query` sink exists) and no `cors()` mount (same-origin deny
  by default — a preflight test would assert absence, which headers already
  prove). Tests: headers present, 400/413 mapping, 429 burst with Retry-After.

### H11. Cookie attributes incomplete; logout may not clear prod cookie

- **Category:** Security / Authentication
- **Severity:** High
- **Location:** `apps/backend/src/app.ts:79-85`
- **Current problem:** No `Max-Age`/`Expires` (30-day absolute not reflected),
  hardcoded `cp_session` instead of `config.sessionCookieName`, and `clearCookie`
  on logout omits `Secure`/`SameSite` so a production Secure cookie may survive
  logout.
- **Recommended improvement:** Use the config constant, set `Max-Age` to the
  absolute lifetime, and mirror `Secure`/`SameSite`/`Path` on clear.
- **Implementation guidance:** Centralize cookie options in one helper used by both
  set and clear paths.
- **Suggested validation:** Cookie-flag tests (Secure in prod, HttpOnly always,
  SameSite=Lax, Max-Age≈30d); manual logout clears cookie in prod-mode fixture.
- **Status: Completed 2026-09-07** — single `sessionCookieOptions()` helper
  (name from `config.sessionCookieName`, `Max-Age=2592000` for the 30-day
  absolute lifetime) used by both set and clear; logout clear mirrors
  Secure/SameSite/Path with `Max-Age=0`; auth middleware reads the same config
  constant. Test asserts flags on redeem + mirrored clear on logout.
  (Secure flag is production-only by design — local dev stays plain HTTP.)

### H12. Backup encryption is non-authenticated CBC; bucket object never re-verified

- **Category:** Reliability / Security (DevOps)
- **Severity:** High
- **Location:** `ops/backup.sh:54-78`; `ops/restore-drill.sh:53-59`
- **Current problem:** `openssl enc -aes-256-cbc -pbkdf2` uses default 10k
  iterations and no authentication (malleable). Integrity is checked only on the
  local file pre-upload; the bucket object is never re-downloaded/verified, so
  partial uploads or wrong-bucket pushes go undetected. `UPLOAD_CMD` is unquoted
  (word-splitting/injection if env-controlled).
- **Recommended improvement:** Prefer AES-256-GCM via `age`/`gpg`, or at minimum
  `-pbkdf2 -iter 600000` + detached SHA-256 manifest; verify the bucket object
  post-upload (re-download + hash); quote `UPLOAD_CMD`.
- **Implementation guidance:** Add `--verify`/content-md5 to the OCI push, store the
  manifest alongside the artifact, and assert equality in `test-backup.sh`.
- **Suggested validation:** Extend `test-backup.sh`: correct-key + tampered-bytes
  case must fail; upload round-trip hash must match.
- **Status: Completed 2026-09-07** — kept AES-256-CBC (no GCM in `openssl enc`
  or Alpine images) but hardened to `-pbkdf2 -iter 600000` + detached `.sha256`
  manifest verified before every decrypt; `UPLOAD_CMD` quoted as
  operator-shell; new `DOWNLOAD_CMD` round-trip verification (missing verifier
  or hash mismatch fails the backup closed); drill rejects tampered artifacts
  via manifest before decrypting. `test-backup.sh` covers manifest match,
  bucket round-trip, both negative upload paths, drill pass with
  deletion-replay proof, and tamper rejection — full script green end to end.
  Follow-up fix (same week): the new upload block wrote the fake bucket and
  tamper copies from the host into a root-owned tree — Permission denied on
  Linux CI (runs #41–43 red, Windows green through NTFS bind semantics). All
  writes into that tree now go through the container; the host only reads.

### H13. Secrets handling gaps: OneDrive sync, test-key gitignore, key in process list

- **Category:** Security (DevOps)
- **Severity:** High
- **Location:** `secrets/local/*.txt`; `.gitignore`; `scripts/test-backup.sh:74-81`;
  `ops/health-check.sh:57-63`; `ops/backup.sh:41-43`
- **Current problem:** (a) The repo lives under OneDrive, which syncs
  `secrets/local/` to Microsoft cloud unless excluded — against the ADR-056 spirit.
  (b) `test-backup.sh` writes a live key to `$ROOT/.drill-key.tmp` + CSV + dumps,
  none of which are git-ignored — a careless `git add -A` commits key material.
  (c) `health-check.sh` interpolates the Resend key into `curl` argv (visible in
  `ps`); `backup.sh` exports `PGPASSWORD` without unsetting it (visible in
  `/proc/*/environ` to same-user processes).
- **Recommended improvement:** Move the repo out of OneDrive or add an exclusion;
  extend `.gitignore` with `backups*/`, `.replay.csv`, `.drill-key.tmp`,
  `tampered.dump.enc`; pass the Resend key via `curl --config` header file;
  wrap `PGPASSWORD` in a subshell + `trap 'unset PGPASSWORD' EXIT`.
- **Implementation guidance:** One-line `.gitignore` addition; health-check rewrite
  of the alert block; backup subshell `(export PGPASSWORD=…; exec pg_dump …)`.
- **Suggested validation:** `git check-ignore` on each artifact path; `ps`-based
  manual check during a dry-run alert; failed-run cleanup test (`kill -9` then
  `git status` shows nothing sensitive).
- **Status: Completed 2026-09-08** — `.gitignore` covers `backups*/`,
  `*.dump.enc*`, `.replay.csv`, `.drill-key.tmp` (proven: `git status` clean
  with live key material present); Resend key travels via a 0600 curl
  `--config` header file (removed + variable unset after send); `PGPASSWORD`
  is function-local + exported only inside `dump_database()` (shipped earlier
  inside the a5985a1 backup commit); OneDrive risk documented in
  `secrets/README.md` with exclusion guidance + `ai_internal_token` added to
  the structure/matrix docs (moving the checkout itself is an operator
  action). Validated: `git check-ignore`, DRY_RUN payload, full
  `test-backup.sh` green locally and in CI (#44).

### H14. Frontend unsafe URL sink (`javascript:`/`data:` executable on click)

- **Category:** Security / Frontend
- **Severity:** High
- **Location:** `apps/frontend/app/dashboard/page.tsx:159,162-168`
  (`<a href={u} target="_blank" rel="noreferrer">`)
- **Current problem:** `preferredApplicationUrl` / `alternativeApplicationUrls` from
  poisoned listings flow directly into `href` with no scheme allowlist, so
  `javascript:` or `data:` payloads execute on click. `rel="noreferrer"` without
  `noopener` also leaves `window.opener` risks in some browsers.
- **Recommended improvement:** Allowlist `https:` only (http with explicit warning
  at most); render anything else as plain text; use `rel="noopener noreferrer"`.
- **Implementation guidance:** Add an `isSafeHttpUrl(u)` helper (`new URL`, protocol
  check, try/catch → unsafe); unit-test with `javascript:`, `data:`, `https:` cases.
- **Suggested validation:** Frontend unit test on the helper + manual click-through
  with a poisoned fixture.

### H15. Missing FK/operational indexes + dead `superseded` column + GUC-gated deletes

- **Category:** Database / Performance
- **Severity:** High
- **Location:** `db/migrations/0001_init.sql` (`forbid_mutation`, `evaluations.superseded`,
  unindexed FKs); `0004_sources.sql`; `0006_run_targets.sql`; `0007_dashboard.sql`
- **Current problem:** (a) Any DB role can `SET app.retention_sweep='on'` and delete
  append-only rows — no role separation or `SECURITY DEFINER` sweep function.
  (b) `evaluations.superseded` can never be flipped (UPDATE forbidden) — dead column
  that misleads queries filtering on it. (c) Missing indexes on hot FK/sweep paths
  (`attempts.discovery_run_id`, `observations.collected_by_run_id/observed_at`,
  `evaluations.profile_version_id/input_observation_id`, audit actor/action/
  correlation, sessions expiry, signin_links expiry, resume sweep columns) cause seq
  scans and lock contention at scale.
- **Recommended improvement:** Restrict the sweep path (dedicated role or
  `SECURITY DEFINER` function), drop-or-maintain `superseded` (prefer derived
  supersession + remove the column), and add the missing indexes concurrently.
- **Implementation guidance:** New migration with `CREATE INDEX CONCURRENTLY`
  (separate tx), `DROP INDEX` old ones non-concurrently only in a maintenance window;
  decide superseded fate against ADR-005/037 and record in tasks.
- **Suggested validation:** `EXPLAIN` on hot queries before/after; schema tests for
  sweep-role restriction and supersession derivation.
- **Status: Completed 2026-09-07** — migration `0008_perf_indexes.sql` adds all
  13 missing indexes (attempts, observations latest/run/observed, evaluation
  inputs, audit action/actor/correlation, signin expiry, resume grace,
  history/exceptional-access sweeps; verified by a schema-test count) and
  drops the dead `evaluations.superseded` column (supersession stays derived
  per ADR-005/037; the two `superseded = false` predicates removed as
  no-ops). Sweep-role separation explicitly deferred with rationale in the
  migration header (single app DB role — separation would be theater without
  a second principal). Validated: `test-schema.ps1` ALL PASSED + full vitest
  suite green.

### H16. Unbounded reevaluation + ignored source scoping (DoS-by-profile-change)

- **Category:** Performance / Reliability
- **Severity:** High
- **Location:** `apps/backend/src/evaluation/reevaluation.ts:24-26,60-76`
- **Current problem:** No LIMIT/pagination, sequential `await` per job, each
  potentially an AI call — one profile change with N jobs = N AI calls inside a
  single HTTP request (timeouts, quota burn). `allowedSources` is fetched then
  `void`ed, so ADR-041 source scoping is unenforced; company filter uses
  `MIN(strong_match_key)` lexicographic pick, not the primary listing.
- **Recommended improvement:** Bound (e.g., 50) + paginate, and move reevaluation to
  pg-boss instead of inline; enforce `allowedSources`; fix company resolution.
- **Implementation guidance:** Add `limit` param, enqueue per-batch jobs, wire the
  source filter into the candidate query.
- **Suggested validation:** Test with 200-job fixture: bounded AI calls, paginated
  completion, disallowed sources excluded.
- **Status: Completed 2026-09-07** — selector takes limit/offset (default batch
  50) with truncation reporting; previously-voided `allowedSources` now
  enforced in SQL (job qualifies only via an allowed-source listing);
  company resolution uses the primary listing (latest-observation holder,
  H7-consistent) instead of the lexicographic MIN key; delivery is async via
  a new `evaluation` pg-boss queue (overflow pages re-enqueue; worker handler
  registered) with saves only ever *enqueueing* (fire-and-forget, save never
  fails on broker errors). Tests: source include/exclude, company
  include/exclude, truncation/pagination, enqueue contract + failure, and
  save-route enqueue capture.

---

## Medium

### M1. Redeem consumes link even when account is inactive (burns single-use link)

- **Category:** Authentication / Reliability
- **Severity:** Medium
- **Location:** `apps/backend/src/identity/signinLinks.ts:158-174`
- **Current problem:** `redeemed_at` is set before the `accounts.state === 'active'`
  check, so a suspension between confirm and redeem burns the user's only link.
- **Recommended improvement:** Check account state first, or restore the link on
  deny. Add a test for suspend-then-redeem.
- **Suggested validation:** Integration test: suspend after confirm → redeem refused,
  link still redeemable after reactivation (or clean re-request path).
- **Status: Completed 2026-09-07** — inactive-account check now runs inside the
  redeem transaction with ROLLBACK (no `redeemed_at` burn); covered by the new
  H3/M1 suspend-then-redeem → reactivate → redeem-succeeds test.

### M2. Sign-in rate-limit check-then-insert races under concurrency

- **Category:** Concurrency / Security
- **Severity:** Medium
- **Location:** `apps/backend/src/identity/signinLinks.ts:46-67`
- **Current problem:** Two concurrent requests can both read counts below the
  3/15min + 10/24h limits and both insert — unlike the orchestrator, no advisory
  lock is used.
- **Recommended improvement:** Take a per-email `pg_advisory_xact_lock` around the
  count + insert, matching `discovery/orchestrator.ts:101`.
- **Suggested validation:** Concurrency test with parallel requests asserting the
  limit holds.
- **Status: Completed 2026-09-07** — count + insert now run inside one
  transaction under a per-email `pg_advisory_xact_lock`; parallel-issuance test
  asserts 5 concurrent requests yield exactly 3 successes.

### M3. `SELECT … FOR UPDATE` outside a transaction is a no-op (closure race)

- **Category:** Concurrency
- **Severity:** Medium
- **Location:** `apps/backend/src/identity/closure.ts:60-63`
- **Current problem:** The lock query runs on a pool checkout with no `BEGIN`, so
  the lock releases immediately and the closed-check races with concurrent close.
- **Recommended improvement:** Move the SELECT … FOR UPDATE inside the redeem/close
  transaction.
- **Suggested validation:** Code review + concurrent closure test.
- **Status: Completed 2026-09-07** — the `SELECT … FOR UPDATE` closed-check in
  `requestClosureConfirmation` moved inside the confirmation transaction (same
  change as H3); no more pool-level no-op lock.

### M4. `updateSearchStrategy` wipes unspecified fields; no size validation

- **Category:** API / Backend
- **Severity:** Medium
- **Location:** `apps/backend/src/profile/searchStrategy.ts:70-83`
- **Current problem:** `sourceTargeting ?? {}` / `disabledSources ?? []` overwrite
  stored config on partial PUT — a `{terms}`-only update silently clears targeting.
  No array bounds, term-length checks, or known-slug restriction → DB bloat / DoS.
- **Recommended improvement:** Preserve existing values when fields are `undefined`;
  validate lengths (e.g., ≤100 terms, ≤200 chars each) and restrict
  `disabledSources` to known slugs.
- **Suggested validation:** API tests: partial update preserves targeting; oversized
  payload rejected with 400.
- **Status: Completed 2026-09-07** — partial PUTs merge over the stored row
  (targeting/sources preserved when omitted); new bounds (≤100 terms/≤200
  chars, `disabledSources` restricted to known slugs, targeting object caps)
  return 400 with the row untouched; route maps invalid to 400. Drive-by fix:
  the `USER_RESOURCES` placeholder loop shadowed the real GET resume +
  search-strategy handlers (Express matches in registration order) — both
  removed from the placeholder list with a regression test.

### M5. Profile content validation is near-absent; non-string skills 500 downstream

- **Category:** Backend / Data validation
- **Severity:** Medium
- **Location:** `apps/backend/src/profile/profileVersions.ts:23-69`;
  `apps/backend/src/evaluation/scoring.ts:99` (`s.toLowerCase()`)
- **Current problem:** Only `function` values are rejected (impossible from JSON).
  Arbitrary keys, nesting depth, and sizes pass; non-string `skills` items crash
  scoring with a 500.
- **Recommended improvement:** Schema-check `target_role`, `skills` (string items,
  capped count/length), `priorities`, plus overall size caps and depth limits.
- **Suggested validation:** Unit tests: non-string skill → 400 at save, never 500 at score.
- **Status: Completed 2026-09-07** — `validateProfileContent` now schema-checks
  `summary`/`target_role` strings, `skills` (string items, ≤100, ≤200 chars),
  `priorities` (higher/normal/lower only), `certifications`, settings count
  cap, plus 50 KB size and depth-5 bounds; the engine additionally coerces
  legacy non-string skills so old rows score instead of 500. Tests cover
  save-time rejection (nothing persisted) and legacy-row scoring.

### M6. UUIDs never validated at the edge (malformed → 500 noise)

- **Category:** API / Reliability
- **Severity:** Medium
- **Location:** `apps/backend/src/app.ts` (all `:accountId`, `:jobId`, `:documentId`,
  `:draftId`, `:id` params)
- **Current problem:** Malformed UUIDs reach pg and raise `invalid input syntax for
  type uuid` → 500 `internal_error`. Fail-closed but noisy and masks real errors.
- **Recommended improvement:** Add a UUID param guard returning 400/404 before any query.
- **Suggested validation:** Route tests with `not-a-uuid` asserting 400/404, never 500.
- **Status: Completed 2026-09-07** — path-scanning global guard returns
  non-disclosing 404 for malformed `:accountId`/`:jobId`/`:documentId`/
  `:draftId`/`:id` before any query (grant/link tokens are opaque strings and
  unaffected). Implementation note: per-path `app.use()` mounts were rejected
  — Express strips use-mount prefixes from downstream route matching and broke
  every account route (caught by the storage suite). Route tests assert 404 +
  `{error:not_found}` on five shapes, never 500.

### M7. Draft edit/accept TOCTOU + conflated 404/409

- **Category:** Concurrency / API
- **Severity:** Medium
- **Location:** `apps/backend/src/profile/drafts.ts:47-62,93-103,137-149`;
  `apps/backend/src/app.ts:495-507`
- **Current problem:** `editDraft` checks `status==='ready'` then UPDATEs with
  `WHERE status='ready'` but ignores `rowCount` — concurrent accept returns
  `ok:true` despite zero rows. `discardDraft` returns `false` for both missing and
  non-ready, so the route always emits 409 even for 404.
- **Recommended improvement:** Check `rowCount` after conditional UPDATEs;
  distinguish `not_found` from `conflict` in return types.
- **Suggested validation:** Concurrency test (edit vs accept) + 404-vs-409 tests.
- **Status: Completed 2026-09-07** — `editDraft` checks `rowCount` and
  re-reads to return `not_found` vs `not_editable`; `acceptDraft` claims the
  draft with a conditional `status='ready'` update (loser rolls back its
  version insert); `discardDraft` returns `not_found`/`not_editable` and the
  route maps them to 404/409 (was always 409). Tests cover both distinctions
  plus the post-accept edit race.

### M8. Session idle-write on every request; per-request admin re-lookup

- **Category:** Performance
- **Severity:** Medium
- **Location:** `apps/backend/src/identity/sessions.ts:127-131`;
  `apps/backend/src/middleware/auth.ts:49-52`
- **Current problem:** Every authenticated request does an `UPDATE sessions SET
  last_seen_at…` (write amplification, pool pressure) plus a redundant
  `SELECT is_admin`. Validate→use race still allows requests through between
  validation and handler after revocation.
- **Recommended improvement:** Lazy idle-write (only if `last_seen_at` older than
  ~5 min); fold `is_admin` + active checks into the single `validateSession` join.
- **Suggested validation:** Benchmark query count per request; test idle-deadline
  still enforced.
- **Status: Completed 2026-09-07** — the idle UPDATE now runs only when
  `last_seen_at` is older than ~5 min (deadline stays exact within that
  granularity; steady traffic drops to ~1 write/5 min/session). The
  `is_admin` + state checks were already a single joined query. Drive-by fix:
  `createSession` now stamps `last_seen_at` from the caller clock instead of
  `DEFAULT now()` (test-clock consistency). Test proves skip-then-refresh
  behavior; idle-deadline suites still green. Residual: the validate→use race
  is inherent to middleware auth and unchanged.

### M9. Worker lifecycle gaps: stale readiness, SIGTERM abandons jobs, no correlation

- **Category:** Reliability / Observability
- **Severity:** Medium
- **Location:** `apps/backend/src/worker/index.ts:17-23,28-83`;
  `apps/backend/src/work/boss.ts:53-56`
- **Current problem:** `dbOk` sampled once at boot (readiness lies thereafter);
  `SIGTERM/SIGINT → process.exit(0)` abandons in-flight pg-boss jobs without
  `boss.stop()`; no `withCorrelation` wiring so correlation IDs are absent from
  worker logs; `ENQUEUE_POLICY` covers only extraction/collection, leaving future
  queues on library defaults.
- **Recommended improvement:** Refresh readiness per probe, `await boss.stop()` on
  shutdown, propagate correlation IDs through job payloads, complete
  `ENQUEUE_POLICY` for all queues.
- **Suggested validation:** Shutdown test (in-flight job drains); readiness probe
  test after DB drop; log inspection for correlation IDs.
- **Status: Completed 2026-09-07** — readiness pings the DB live per probe
  (no more boot-time sample); SIGTERM/SIGINT drains via `boss.stop()` +
  pool close with a 25s cap (exit 0 verified on the dev stack); each job
  handler runs in a `withCorrelation` scope; `ENQUEUE_POLICY` now covers all
  seven queues. Verified: unit tests (policy completeness, correlation IDs in
  logs), worker image rebuilt + booted healthy (`worker_ready`), SIGTERM exit
  0 with healthy restart. Payload-carried producer IDs remain future work for
  the enqueue path.

### M10. Availability refresh N+1; freshness uses MAX (least conservative)

- **Category:** Performance / Backend
- **Severity:** Medium
- **Location:** `apps/backend/src/sources/pipeline.ts:265-307`
- **Current problem:** One query per listing for the latest observation; freshness
  takes `Math.max(…)` across sources, so a 21-day RemoteOK window keeps a job
  `active` even when 14-day Greenhouse/Lever windows are stale. Non-null assertions
  (`signals.find(…)!`, `rows[0].canonical_job_id!`) throw on edge data.
- **Recommended improvement:** Batch with `DISTINCT ON (listing_id)`;
  confirm max-vs-min intent with the domain decision (default to most conservative);
  replace `!` with explicit checks.
- **Suggested validation:** Performance test on multi-listing fixture; unit tests for
  stale-source matrix and empty-signal edge.
- **Status: Completed 2026-09-07** — latest-observation lookup batched into one
  `DISTINCT ON` query (no more per-listing roundtrips); freshness is now
  per-source (each signal judged by its own window — a fresh RemoteOK copy
  keeps the job active despite a stale Greenhouse copy, and an 18d RemoteOK-only
  job stays active under its 21d window); both non-null assertions replaced
  with explicit handling. Tests cover the stale-source matrix and the
  no-observation edge. The old pure `computeAvailabilityState` helper and its
  unit tests are untouched.

### M11. Logger allows field spoofing; minimization is convention-only; correlation unwired

- **Category:** Observability / Privacy
- **Severity:** Medium
- **Location:** `apps/backend/src/observability/logger.ts:27-42`
- **Current problem:** `...fields` spread after `correlationId` lets callers override
  `ts/level/event/correlationId`. No runtime redaction — any future caller can pass
  PII undetected except via the single journey test. `withCorrelation` is never
  called in `app.ts`/worker, so prod logs lack correlation IDs.
- **Recommended improvement:** Freeze reserved keys (caller fields cannot override),
  add a denylist/redaction pass for email/phone/URL patterns, and wire
  request-scoped correlation middleware + job-payload propagation.
- **Suggested validation:** Logger unit tests (override attempt ignored, PII
  redacted); HTTP test asserting correlation ID present in logs.

### M12. Frontend error states systematically missing; double-submit possible

- **Category:** Frontend / Reliability
- **Severity:** Medium
- **Location:** `apps/frontend/app/page.tsx:12-16`; `app/signin/page.tsx:14-56`;
  `app/dashboard/page.tsx:48-137`; `app/closure/page.tsx:9-44`; `lib/api.ts:1-17`
- **Current problem:** Unhandled promise rejections leave infinite `Loading…`
  states; refresh/acknowledge/review buttons optimistically update on failure
  (`"Discovery queued."` even on 500); no timeout/AbortController/401-redirect in
  the fetch wrapper; sign-in request allows double-submit. Token stays in the URL
  after use (history/logs/`Referer`).
- **Recommended improvement:** Centralize `api()` error handling (timeout,
  non-JSON guard, 401 redirect), add per-action error toasts with rollback,
  disable buttons while pending, and `router.replace("/signin")` after consuming
  the token.
- **Suggested validation:** Frontend tests (offline → error state, failed POST →
  rollback); manual double-click test.

### M13. Frontend accessibility, encoding, and React-correctness gaps

- **Category:** Accessibility / Frontend
- **Severity:** Medium
- **Location:** `apps/frontend/app/signin/page.tsx:70-77`; `app/dashboard/page.tsx:133-288`;
  `app/layout.tsx:1-13`; `app/closure/page.tsx`
- **Current problem:** Sign-in input has placeholder-only labeling (WCAG 3.3.2
  failure), no `autoComplete="email"`, no `aria-disabled`; dashboard toggles lack
  `aria-expanded`/`aria-controls`, buttons lack `type="button"`, errors lack
  `role="alert"`; `DetailRow`/`Job` defined inside the parent component (state
  resets on every parent render); `loadDetail` uses `me!.accountId` (crash race);
  em-dashes/arrows render as mojibake (`â€”`, `â†’`) — file mis-encoded, user-visible.
- **Recommended improvement:** Add proper `<label>`s, ARIA wiring, and error roles;
  hoist inner components to module scope; guard `me === null`; re-save affected
  files as UTF-8; add `eslint-plugin-jsx-a11y` + `react-hooks`.
- **Suggested validation:** `axe` scan, ESLint with a11y plugin, visual check of
  punctuation, interaction test expanding job details after parent re-render.

### M14. AI service hardening gaps: unbounded input, injection shape, upstream mapping

- **Category:** Security / Reliability (AI)
- **Severity:** Medium
- **Location:** `services/ai/main.py:24-79`
- **Current problem:** `content: str` has no max length (cost/DoS/OOM); untrusted
  resume text is concatenated directly under the instruction with no delimiters or
  generation limits; `URLError`/timeout/malformed-upstream paths are unhandled
  (500 + traceback); no transient-vs-nontransient mapping for ADR-044; no response
  shape validation (arbitrary Gemini JSON passed through); `GEMINI_MODEL`
  unconstrained; `LOG_LEVEL` unvalidated.
- **Recommended improvement:** `max_length` (e.g., 50k chars) + FastAPI body limit;
  wrap content in explicit delimiters; catch network/timeout errors → 502 with
  retry-hint mapping; validate proposal shape (defense in depth, Node authoritative);
  allowlist model names and log levels.
- **Suggested validation:** pytest for oversized input (400/413), timeout fixture
  (502, no traceback), malformed upstream (502 `unparseable_output`), identifier
  probe (see O-findings).
- **Status: Completed 2026-09-07** — explicit delimiter wrapping, 2048-token
  generation bound, network/timeout → 503 vs HTTP → 502 mapping (no traceback),
  outer-JSON + non-object-proposal guards, allowlisted `GEMINI_MODEL` (fallback
  to default) and `LOG_LEVEL`; Node maps task rejections 400/422 to terminal
  `malformed_output` instead of retryable unavailability. Tests: `pytest`
  tripwire (4 identifier classes, no upstream call), minimized-like content
  pass-through, 503/502 mappings, allowlist fallback; vitest rejected-task
  terminality.

---

## Low

### L1. `decodeURIComponent` can throw 500 in auth middleware

- **Category:** Reliability
- **Severity:** Low
- **Location:** `apps/backend/src/middleware/auth.ts:28`
- **Current problem:** Malformed `cp_session=%E0%A4%A` throws synchronously,
  bypassing the 401 path into the generic 500 handler.
- **Recommended improvement:** Wrap in try/catch → 401.
- **Suggested validation:** Test with malformed cookie → 401, never 500.

### L2. Grant tokens in URL path; sign-in token handling inconsistencies

- **Category:** Security / API
- **Severity:** Low
- **Location:** `apps/backend/src/app.ts:355,394`; `apps/frontend/app/signin/page.tsx:44-56`;
  `app/closure/page.tsx:20,32`
- **Current problem:** Upload/download grants ride in path segments (see H9 for the
  log-redaction fix). Separately, closure/signin fetches inconsistently omit
  `credentials:"include"`, and sign-in email input is not trimmed/lowercased
  client-side.
- **Recommended improvement:** Move grants to header/body (H9); standardize
  `credentials:"include"` on all cookie-authed fetches; normalize email input.
- **Suggested validation:** Header review + login-flow test with mixed-case email.

### L3. Orphan objects / false success audits on storage paths

- **Category:** Reliability
- **Severity:** Low
- **Location:** `apps/backend/src/profile/resumes.ts:100-119,154-168`
- **Current problem:** `store.put` before INSERT/COMMIT can leak objects on DB
  failure; `downloadWithGrant` audits success before verifying the object exists
  (`doc.rows[0]` unchecked → TypeError + false success audit).
- **Recommended improvement:** Verify existence first; put-after-commit or add a
  reconciliation sweep; guard `rows[0]`.
- **Suggested validation:** Fault-injection tests (DB fail after put → no leak;
  missing object → `invalid_grant`, no success audit).

### L4. Secret-reading duplicated; config contract incomplete

- **Category:** Code Quality / DevOps
- **Severity:** Low
- **Location:** `apps/backend/src/config.ts:36-38`; `apps/backend/src/work/boss.ts:24-25`;
  `.env.example`
- **Current problem:** Two secret-reading paths drift; `readSecret` throws raw
  ENOENT on missing files (boot stack instead of operational message);
  `.env.example` omits ~15 actually-consumed vars (`APP_PUBLIC_URL`, `NODE_ENV`,
  `BACKUP_*`, `UPLOAD_CMD`, `ALERT_RECIPIENT`, `OBJECT_STORE_DRIVER`,
  `AI_INTERNAL_URL`, `GEMINI_MODEL`, …).
- **Recommended improvement:** Single `readSecret` used everywhere with a friendly
  missing-file error; extend `.env.example` with commented placeholders + pointer
  to `fetch-vault-secrets.sh`.
- **Suggested validation:** Boot test with missing secret → clear message; doc review.
- **Status: Completed 2026-09-08** — single `readSecretFile` behind every
  secret load (`readSecret`, pg-boss password, AI token, Resend key) with an
  operational missing/empty-file error (ADR-056 pointer, never raw ENOENT);
  intentional dev/test fallbacks preserved (mailer/AI return null);
  `.env.example` documents every consumed non-secret variable with defaults
  and Vault pointers. Tests cover missing/empty/valid loads.

### L5. Migrations not idempotent / production-unsafe patterns

- **Category:** Database / DevOps
- **Severity:** Low
- **Location:** `db/migrations/0001_init.sql` (`CREATE TABLE` without `IF NOT EXISTS`,
  seed INSERT without `ON CONFLICT`); `0005_work.sql` (non-concurrent index rebuild
  takes `ACCESS EXCLUSIVE`); `0004_sources.sql` (timestamp rewrite on re-run);
  `tools/migrate.ts` (no advisory lock)
- **Current problem:** Re-runs fail; index rebuild blocks prod; migrator + worker
  concurrent boot can double-apply.
- **Recommended improvement:** `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` guards,
  `CREATE INDEX CONCURRENTLY` in separate tx, `WHERE … IS NULL` guards, migrator
  advisory lock.
- **Suggested validation:** Re-run migrations twice in CI; concurrent-boot test.
- **Status: Completed 2026-09-08** — every migration re-applies cleanly
  (IF NOT EXISTS / DROP IF EXISTS / ON CONFLICT / COALESCE guards across
  0001/0002/0003/0004/0005/0006/0007; 0008 already guarded); migrator takes
  the `careerpilot-migrator` advisory lock BEFORE creating
  schema_migrations on one dedicated connection; default migrations path
  uses fileURLToPath (was broken on Windows hosts). Proven: full double
  raw re-apply with ON_ERROR_STOP=1 clean, plus 3 concurrent Linux
  migrator runs on a fresh DB → exactly one applier, two
  `migrations_up_to_date` no-ops (first attempt caught the winner's
  CREATE TABLE race, fixed by lock-first ordering). Note: 0005's landed
  index rebuild stays as-is (already applied); future index work goes
  CONCURRENTLY outside a tx per the 0008 header note.

### L6. Docker images: JIT TS in prod, `npm install`, missing ignores, floating tags

- **Category:** DevOps / Dependency Management
- **Severity:** Low
- **Location:** `apps/backend/Dockerfile`; `apps/frontend/Dockerfile`;
  `services/ai/Dockerfile`; `compose.yaml`; root `.dockerignore`
- **Current problem:** Backend ships source + `tsx` JIT (attack surface, slow cold
  start, skips `tsc` gate); images use `npm install` not `npm ci`; frontend context
  lacks `.dockerignore` (ships `node_modules`/`.next`); all base images float
  (`postgres:17-alpine`, `caddy:2-alpine`, `node:22-alpine`, `python:3.12-slim`);
  no `HEALTHCHECK`/`EXPOSE` consistency, no `tini`, root `.dockerignore` omits
  `ops/`, `scripts/`, `caddy/`, backups.
- **Recommended improvement:** Multi-stage builds (`npm ci` → `tsc` build →
  `node dist`), frontend `.dockerignore` + standalone output, pin digests +
  Dependabot, tighten ignore files.
- **Suggested validation:** CI `docker build` of all three images (currently missing);
  image-size + cold-start comparison.
- **Status: Completed 2026-09-08** — backend is multi-stage (`npm ci` →
  `tsc -p tsconfig.build.json` → `node dist`, tsx moved to devDependencies,
  `dev`/`start` scripts split for local vs prod); frontend is multi-stage
  with `output: standalone` runtime (17 modules, no source/devDeps);
  all installs are `npm ci`; base images + compose postgres/caddy are
  digest-pinned with `.github/dependabot.yml` (docker/npm/pip/actions)
  covering bumps; per-context `.dockerignore` added (frontend/ai) and root
  tightened (ops/scripts/caddy/backups/tests). Proven: all three images
  build, `compose up --build --wait` fully healthy, public
  `/api/healthz` ok via Caddy + frontend 200. Two real bugs caught:
  standalone binds Docker's HOSTNAME (fixed with `HOSTNAME: 0.0.0.0`) and
  the lockfile lagged the tsx move (re-synced). Deliberately skipped:
  in-image HEALTHCHECK (compose already healthchecks every service) and
  tini (single-process exec-form images; node handles SIGTERM as PID 1).

### L7. CI gaps: no secrets/dependency scanning, no prod builds, weak hardening

- **Category:** DevOps / Testing
- **Severity:** Low
- **Location:** `.github/workflows/ci.yml`
- **Current problem:** No gitleaks/trufflehog, no `npm`/`pip` audit, no image scan
  (notably `next@15`/`react@19`/`express@5` CVE coverage), CI never builds prod
  images, floating action versions without SHAs, no `permissions:`/`timeout-minutes`/
  `concurrency`, misleading `identity` job name (runs the whole suite), no coverage
  thresholds or artifact uploads.
- **Recommended improvement:** Add secret + audit + `trivy` steps, build all images,
  pin SHAs, set least-privilege permissions and timeouts, split or rename the test job.
- **Suggested validation:** Workflow dispatch run showing each new step green/red
  appropriately; Dependabot PR on next advisory.
- **Status: Completed 2026-09-08** — `secrets-scan` (gitleaks full history,
  proven clean locally: 51 commits, no leaks), backend `npm run build` prod
  gate + blocking `npm audit` (fixed the one qs moderate via lock-only
  bump, now 0 vulns), frontend/pip audits advisory with the known cause
  recorded (next@15 postcss/sharp HIGHs → next@16 Dependabot PR;
  starlette 0.46.2 PYSEC items need a fastapi minor bump — tried,
  ResolutionImpossible), new `images` job (builds all 3 prod images,
  dist/no-tsx smoke check, trivy report-only + SARIF upload), all actions
  SHA-pinned (Dependabot github-actions covers bumps), top-level
  `contents: read` + per-job `security-events: write` only for SARIF,
  `concurrency` cancel, `timeout-minutes` everywhere, `identity` renamed
  `backend-tests`. Deliberately report-only for trivy: fresh-image scan
  shows the remaining HIGH/CRITICALs live in base layers (npm-bundled tar
  in node:22-alpine, debian perl/util-linux in python:3.12-slim) — a
  blocking gate would be permanently red; verified the earlier tar list
  was a stale pre-lock-sync image. Coverage thresholds deferred (needs a
  new dep + baseline; suggest follow-up).

### L8. Tests: stale truncate list, zero frontend/AI coverage, untested ops paths

- **Category:** Testing
- **Severity:** Low
- **Location:** `apps/backend/test/helpers.ts:15-23`; `apps/frontend/` (no tests);
  `services/ai/` (no pytest); `ops/health-check.sh`; `scripts/fetch-vault-secrets.sh`
- **Current problem:** `resetDb` omits ~7 tables (cross-test leakage/order
  dependence); frontend has zero tests; AI has only ruff+import smoke; health-check
  alert path, `fetch-vault-secrets.sh` OCI syntax (likely wrong
  `--query 'data."secret-batch-content".content'` — **needs verification** against
  real `oci vault secret get-secret-bundle` output), backup rotation/`UPLOAD_CMD`
  failure/`flock` all untested; isolation is app-only (no RLS, no route-coverage audit).
- **Recommended improvement:** Fix truncate list from migrations; add Vitest +
  Playwright smoke for disclosure/closure/dashboard; add pytest for `/extract`
  mapping; shellcheck + dry-run test for health-check; integration-test the Vault
  fetch against the real CLI shape before first prod run.
- **Suggested validation:** Full suite green + new coverage; `shellcheck` clean.

---

## Optional Improvements

### O1. Defense-in-depth minimization check inside the AI service

- **Category:** Privacy
- **Severity:** Optional
- **Location:** `services/ai/main.py` (see also `apps/backend/src/profile/minimization.ts`)
- **Current problem:** ADR-054 minimization is asserted by comment only; a Node bug
  would forward identifiers straight to Gemini with no backstop.
- **Recommended improvement:** Add a lightweight identifier scan (email/phone/URL/
  UUID patterns) that rejects with 400 before calling upstream. Node remains
  authoritative; this is a tripwire.
- **Suggested validation:** pytest with identifier-laden content → 400, no upstream call.
- **Status: Completed 2026-09-07** — implemented together with M14 (same
  service boundary, one logical change): email/phone/URL/UUID scan mirroring
  `minimization.ts` patterns rejects with 400 `identifier_detected` before any
  upstream call; Node remains authoritative. Covered by the M14 pytest tripwire
  suite.

### O2. Metrics, tracing, and queue-depth observability

- **Category:** Observability
- **Severity:** Optional
- **Location:** `apps/backend/src/observability/`; `ops/health-check.sh`;
  `compose.yaml` (no limits/rotation)
- **Current problem:** No metrics (Prometheus/OTel), no trace propagation
  Caddy→backend→worker→AI, health-check misses `/readyz`, pg-boss depth, cert
  expiry, and backup integrity; no alert dedup/backoff (every cron tick re-sends);
  no Compose `deploy.resources` or log rotation — risky on one Always Free VM.
- **Recommended improvement:** Add minimal metrics endpoint + queue-depth check,
  propagate a `correlationId` header through Caddy/backend/worker/AI, extend
  health-check (readyz, queue depth, cert, decrypt-verify, memory/inode), add
  dedup/backoff, and set `mem_limit` + `logging: {max-size, max-file}` per service.
- **Suggested validation:** Load soak + kill-dependency drills; log-volume measurement.

### O3. Pagination, filtering, and response envelope consistency

- **Category:** API
- **Severity:** Optional
- **Location:** `apps/backend/src/app.ts`; `apps/backend/src/dashboard/jobs.ts`
- **Current problem:** No shared pagination envelope, no `Retry-After` on 429 (no
  429 emitted), `express.json()` limit implicit (~100 kB) with 500 instead of 413
  on oversize, no `updated_at` auto-bump triggers (app must maintain timestamps).
- **Recommended improvement:** Standard `{data, nextCursor}` envelope, explicit
  `express.json({limit})` + JSON-error middleware → 413/400, DB timestamp triggers.
- **Suggested validation:** Contract tests on pagination + oversized payload.

### O4. Accessibility/SEO/responsive polish pass

- **Category:** Accessibility / Frontend
- **Severity:** Optional
- **Location:** `apps/frontend/app/layout.tsx`; `next.config.mjs`
- **Current problem:** No `viewport`/`description`/`metadataBase`, no global error
  boundary or skip link, no `poweredByHeader:false`, no `output:"standalone"`,
  inline-styles-only responsive (no media queries/focus-visible).
- **Recommended improvement:** Fill metadata, add error boundary + skip link,
  enable standalone output, add a small design-system pass with focus states.
- **Suggested validation:** Lighthouse + `axe` scores before/after.

### O5. Dependency hygiene and supply-chain pinning

- **Category:** Dependency Management
- **Severity:** Optional
- **Location:** `apps/backend/package.json`; `apps/frontend/package.json`;
  `services/ai/requirements.txt`; Dockerfiles; `compose.yaml`
- **Current problem:** `^` ranges float minors, `tsx`/`esbuild` ships to prod,
  `pydantic` transitive-only, pip without hashes, base images unpinned — no SBOM.
- **Recommended improvement:** Pin exact versions + hashes for prod, replace prod
  `tsx` with compiled output, add Dependabot + SBOM (`cyclonedx`) + audit steps.
- **Suggested validation:** Reproducible `npm ci` + `pip install --require-hashes`
  from clean cache; SBOM artifact in CI.

---

## Post-Audit Findings (added during implementation)

### X1. Caddy stripped the `/api` prefix — every browser API call 404'd in deployment

- **Category:** Reliability / Deployment
- **Severity:** Critical
- **Location:** `caddy/Caddyfile`, `caddy/Caddyfile.production`
  (`handle_path /api/*`); found 2026-09-07 during H9 validation via `caddy adapt`
  (emits `strip_path_prefix: /api`) and confirmed live (`/api/me` → 404 through
  Caddy instead of 401).
- **Problem at discovery:** `handle_path` strips the matched prefix before
  proxying, but backend routes are defined WITH the `/api` prefix — so in any
  Compose deployment every frontend API call fell through to the backend
  unknown-route 404. The stack looked "healthy" because only pages and the
  prefix-less `/healthz` were ever probed through Caddy. Direct-to-backend
  tests never caught it (they bypass Caddy).
- **Fix applied 2026-09-07:** `handle_path` → `handle` (prefix preserved) in
  both Caddyfiles, plus `/api/healthz` + `/api/readyz` backend aliases so the
  Caddy container healthcheck keeps passing.
- **Validation performed:** `caddy validate` on both files; new vitest case
  covering all four health paths; live dev-stack probes after rebuild —
  `/api/me` → 401 (was 404), `/api/healthz` → 200, `/` → 200, all containers
  healthy.
- **Status: Completed 2026-09-07**

---

## Recommended Implementation Order

Safest and most logical sequence (respects dependencies; re-run the ADR-030 gate
rows touched by each change per the sign-off record):

1. **Access control + prod-blockers (C1–C5, H1–H2):** admin role issuance, AI caller
   auth, Resend wiring, extraction/job-detail/evaluate ownership, Bearer removal.
   Re-run identity + authorization + adversarial suites.
2. **Terms-compliance + retention truthfulness (C6–C8, H5, H7):** real collection
   pacing, `targeted_sources` population, shared `getCurrentJobView`,
   resume-grace writer + artifact sweeper, observation-delete guards. Re-run
   sources, discovery, evaluation, retention suites.
3. **Concurrency correctness (H3–H4, M1–M3, M7):** atomic redeem/close, advisory
   locks + `ON CONFLICT` for extraction/versions/canonical/sign-in limits, draft
   row-count checks, closure lock in-tx.
4. **External-input hardening (H8, H10–H11, M5–M6, M14):** adapter shape/size caps,
   helmet/rate-limit/headers, cookie fix, profile schema + UUID guards, AI input
   limits + upstream mapping.
5. **Performance (H6, H15–H16, M8–M10):** dashboard batching + pagination,
   missing indexes (concurrently), bounded async reevaluation via pg-boss, lazy
   session writes, availability batching.
6. **Secrets/deploy/CI (H9, H12–H13, L4–L7):** Caddy log redaction + grant-token
   move, backup cipher/upload verification + Vault key coverage, OneDrive exclusion
   + gitignore, `.env.example`, multi-stage pinned images, CI scanning + builds.
7. **Frontend reliability + a11y (H14, M12–M13, L2, O4):** safe-URL helper, error
   states + timeouts + token-strip, labels/ARIA/encoding fix, metadata/standalone.
8. **Coverage + observability (L1, L3, L8, O1–O3, O5):** truncate-list fix, frontend
   + AI tests, ops-path tests, Vault-syntax verification, minimization tripwire,
   metrics/tracing/queue-depth, pagination envelope, dependency pinning.

*Notes on assumptions:* OCI Vault CLI query shape (L8), exactимо prod Caddy header
support, and `evaluations` FK `ON DELETE` behavior are flagged **needs verification**
against the live migration output before implementing. No application code was
modified in producing this audit.
