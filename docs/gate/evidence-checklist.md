# ADR-030 Release-Validation Evidence Checklist (T9.1)

Compiled 2026-08-24 at gate review. Every dimension maps to executable,
version-controlled evidence. Re-run relevant rows on any material change to
authentication, authorization, sensitive-data processing, external
processors, source policy, or retention.

## 1. Unauthenticated denial

| Evidence | Location |
|---|---|
| Unauthenticated requests denied on every protected resource type | `apps/backend/test/authorization.test.ts` → "unauthenticated requests are denied…" |
| Fail-closed on unknown routes / revoked sessions | `test/authorization.test.ts` → "revoked sessions fail closed immediately"; `src/app.ts` 404 fallback |

## 2. User-to-user isolation

| Evidence | Location |
|---|---|
| Cross-account denial for every resource type (profile, resume, search-strategy, discovery-runs, evaluations, reviews) | `test/authorization.test.ts` → "cross-account access returns denial…"; ownership middleware `src/middleware/auth.ts` (requireSelf, 404 non-disclosure) |
| Dashboard surface isolation (jobs/detail/review/strategy/closure/disclosures) | `test/dashboard.test.ts` → "isolation across the dashboard surface" |
| Resume download grants refuse cross-account owners | `test/storage.test.ts` → "cross-account download grants are refused" |
| Evaluations/reviews strictly per-account (unique constraints + FKs) | `db/migrations/0001_init.sql` |

## 3. Administrator least privilege

| Evidence | Location |
|---|---|
| Admins have no routine access to user content | `test/authorization.test.ts` → "administrators have no routine access…"; requireAdmin scope in routes |
| Non-administrators denied admin functions | same file → "non-administrators are denied administrative functions" |
| Dual-control role changes; self-elevation refused AND audited; last-admin guard; bootstrap documented+audited | `test/admin-roles.test.ts`; `ops/bootstrap-admin.md`; `scripts/bootstrap-admin.sql` |

## 4. Invitation / link / session / suspension / revocation behavior

| Evidence | Location |
|---|---|
| Invitation lifecycle incl. expiry, revocation, re-issue, non-disclosing failures | `test/invitations.test.ts` |
| Opaque single-use links, 15-min TTL, confirmation-before-redemption, prior-link invalidation, rate limits 3/15min + 10/24h | `test/signin-links.test.ts` |
| Session lifetimes 30d/7d user, 12h/1h admin; idle vs absolute; immediate revocation on suspension/closure/admin-removal | `test/sessions.test.ts` |
| Account state machine: closure terminal; closure blocks access + pending auth | `test/account-states.test.ts` |
| Suspension mid-queue stops work (deferred, no results) | `test/collection.test.ts` → "suspension mid-queue stops work" |

## 5. Exceptional-access authorization and auditability

| Evidence | Location |
|---|---|
| Schema-enforced structure (approver ≠ requester; statuses; time limits) | `db/migrations/0001_init.sql` (`exceptional_access_requests`, `administrator_role_changes`) |
| Self-approval and last-admin attempts audited | `test/admin-roles.test.ts` |
| Retention of exceptional-access records = 24 months | `test/retention.test.ts` → exceptional-access expiry |

## 6. Retention / deletion / recovery-copy / preservation-hold behavior

| Evidence | Location |
|---|---|
| Category sweeps: resume grace 30d, shared data 180d, audit 12mo, exceptional access 24mo | `test/retention.test.ts`; `src/observability/retention.ts` |
| Append-only immutability enforced (UPDATE never; DELETE only in marked retention sweep) | `test/schema-tests.sql` sections 1–3 |
| Closure starts deletion lifecycle; truthful status | `test/dashboard.test.ts` → closure flow; `src/identity/closure.ts` |
| Restore drill executed once with recorded outcome incl. deletion-replay proof | `docs/dev/drill-log.md`; `ops/restore-drill.sh`; `ops/deletion-replay.sql` |

## 7. Telemetry & audit minimization; absence of secrets from diagnostics

| Evidence | Location |
|---|---|
| Full-journey log scan finds no resume/profile/job/AI content; JSON lines w/ correlation ids | `test/logging.test.ts` |
| Repo grep secret-scan clean; container env clean; frontend zero secret mounts | Phase 1 session log evidence; `docs/dev/secrets.md` matrix |
| Secrets only via file-mounted Compose secrets, capability-scoped | `compose.yaml` secrets blocks; `docs/dev/secrets.md` |
| Tokens stored hash-only | `src/identity/tokens.ts`; asserted in `test/signin-links.test.ts` |

## 8. Source-policy and external-processor restrictions

| Evidence | Location |
|---|---|
| Per-source terms validations recorded BEFORE first use | `docs/dev/source-terms.md`; `job_sources.terms_validation_*` (migration 0004); gate tested in `test/sources-adapters.test.ts` |
| Conservative limits (~1 rps, ≤3 attempts, Retry-After honored, page budget, non-transient no-retry) | `test/sources-adapters.test.ts` politeness block; `test/collection.test.ts` 401 test |
| Independent disable; disabled adapter makes zero requests | registry gate tests; `test/collection.test.ts` disabled-source test |
| RemoteOK attribution/direct-link restrictions persisted on observations | `test/sources-adapters.test.ts` RemoteOK block; display obligation tracked for release |
| Gemini unpaid-tier terms verified vs ADR-060 (MATCH) + minimization boundary enforced and tested | `docs/dev/current-state.md` preconditions; `test/extraction.test.ts` redaction proofs; `src/profile/minimization.ts` assertMinimized |

## 9. Resistance to adversarial untrusted-content influence

| Evidence | Location |
|---|---|
| Injection text in structured job fields cannot flip constraint outcomes (incl. remote-inference hardening) | `test/adversarial.test.ts` → both constraint blocks |
| Resume-carried instructions cannot add proposal fields or escalate privileges | same file → "resume-carried prompt injection…" |
| Fabricated evidence refs and requirement claims rejected | `test/adversarial.test.ts`; `test/evaluation.test.ts` T6.3 block |
| Workflow state cannot be pushed into invalid transitions via crafted input | `test/adversarial.test.ts` lifecycle block |
| Append-only snapshots resist mutation attempts | same file → "evaluation snapshots remain immutable…" |

## Known residual items (non-blocking, tracked)

- Production OCI Object Storage driver wiring (Phase 8 note): dev/tests use the
  in-memory store behind the S3-compatible interface; wire when tenancy exists.
- RemoteOK display obligations (attribution + direct link) must render on any
  public listing surface before beta users see RemoteOK-sourced jobs.
- Gemini API keys must be restricted (Google rejects unrestricted keys since
  2026-06-19).
