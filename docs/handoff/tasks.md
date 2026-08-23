# Task Breakdown — CareerPilot MVP

Each task lists acceptance criteria that must be demonstrably met (tests or recorded evidence). "Report" means: stop and surface to the decision maker instead of deciding.

## Phase 1 — Foundation

- **T1.1 Compose baseline**: All five services + Caddy defined in version-controlled Compose; only frontend/backend publicly routed; PostgreSQL/worker/FastAPI private. AC: `docker compose up` yields healthy stack; public routes limited per ADR-055.
- **T1.2 Schema and migrations**: Migration tooling implements the domain model (accounts, invitations, sessions, profile versions, resumes metadata, source-listing observations, canonical jobs, availability history, evaluations, reviews, discovery runs/attempts, audit events, idempotency records). AC: migrations apply cleanly; append-only tables reject updates/deletes via constraints/triggers.
- **T1.3 Secrets wiring**: OCI Vault retrieval procedure injects file-mounted Compose secrets; no secret in env vars, images, or repo. AC: grep-based check finds no secrets in code/config; containers read mounted files.
- **T1.4 Local dev environment**: Documented one-command startup with non-production secrets. AC: fresh clone reaches running stack.

## Phase 2 — Identity, Invitations, Sessions

- **T2.1 Invitation lifecycle** (FR-0): issue/accept/expire/revoke; email-bound; re-issue rules. AC: expired/used/revoked invitations fail without disclosing any account information.
- **T2.2 Passwordless links** (ADR-018/026): opaque single-use tokens, confirmation-before-redemption UI step, 15-min validity, issuance limits (3/15min, 10/24h), prior unused link invalidated on new request. AC: automated tests cover each rule including non-disclosing failure responses.
- **T2.3 Sessions** (ADR-027): user 30d absolute/7d idle; admin 12h/1h; immediate revocation on suspension/closure/admin-change. AC: revocation test proves in-flight session dies on suspension.
- **T2.4 Account states** (ADR-025): active/suspended/closed transitions; closed is terminal; closure blocks work immediately. AC: state-machine tests.
- **T2.5 Admin role dual control** (ADR-031): self-approval impossible; last-admin protection; bootstrap documented and audited. AC: attempted self-elevation fails and is audit-recorded.
- **T2.6 Authorization middleware** (ADR-016): deny-by-default resource-level checks on every user-scoped route. AC: cross-account access attempt returns denial for every protected resource type.

## Phase 3 — Profile and Resume Processing

- **T3.1 Resume upload** (FR-2): short-lived scoped upload/download authorization; object encrypted at rest; metadata-only DB record. AC: direct unauthenticated object access fails; upload works through scoped URL.
- **T3.2 Extraction pipeline** (ADR-047/054): Node-owned background task builds minimized FastAPI request → Gemini → structured proposal → Node-side validation. AC: identifier-redaction test proves names/emails/phones/filenames/URLs never reach provider payloads; malformed AI output rejected without persistence.
- **T3.3 Draft review workflow** (FR-2): draft never authoritative until user saves; manual completion path when extraction fails. AC: draft edits don't affect discovery until saved.
- **T3.4 Profile versions** (FR-1–FR-5, ADR-005): immutable snapshots on save; hard-constraint vs preference classification per setting; strict toggles. AC: history preserved; current profile resolves to latest approved version.

## Phase 4 — Source Adapters and Shared Job Pipeline

- **T4.0 Terms validation records** (OPEN item): before each adapter's first use, record its current terms verification. AC: validation record exists per enabled adapter.
- **T4.1 Adapters** (ADR-011/059): Greenhouse, Lever, RemoteOK emit immutable provenance-preserving observations conforming to the shared contract; independently disableable; conservative limits enforced; `Retry-After` honored. AC: limit tests (rate, page budget, timeout); disable test shows zero requests from disabled adapter.
- **T4.2 Normalization stage** (ADR-012/FR-10b): validates observations into common representation preserving provenance and restrictions. AC: malformed observation rejected with recorded outcome.
- **T4.3 Canonicalization stage** (ADR-006/038): layered conservative matching; uncertain matches stay separate; non-destructive reconciliation records. AC: merge/split preserves historical evaluations/reviews.
- **T4.4 Availability processing** (ADR-046/FR-17a): explicit close signals mark unavailable; absence never does; stale/uncertain states after freshness window. AC: state-transition tests covering all four availability states.
- **T4.5 Material-change detection** (ADR-039/FR-16): classify changes; material changes trigger availability/re-evaluation paths. AC: non-material change produces no re-evaluation.
- **T4.6 Application-link selection** (ADR-007): employer ATS link preferred; alternatives retained in detail view.

## Phase 5 — Discovery Orchestration and Background Work

- **T5.1 pg-boss integration** (ADR-049/010): durable queues for extraction, collection, normalization, canonicalization, analysis, evaluation, availability. AC: worker restart mid-job completes work exactly once (idempotency identity).
- **T5.2 Scheduling** (FR-8): once-daily per-user runs aligned to user time zone. AC: schedule test across two time zones.
- **T5.3 Manual refresh guardrails** (FR-9/Flow 5): ~6-hour minimum interval; queue/defer/reject states surfaced truthfully. AC: rapid repeat requests coalesce, not bypass.
- **T5.4 Coalescing** (ADR-042): single active run; overlapping triggers produce ≤1 follow-up run using latest profile. AC: concurrency test with simultaneous scheduled+manual+profile-change triggers.
- **T5.5 Partial-run truthfulness** (ADR-043): failed source doesn't discard other sources' results; status distinguishes complete/partial/failed. AC: forced single-source failure yields partial status with usable results.
- **T5.6 Bounded retry** (ADR-044): transient-only retries within budget honoring source timing; non-transient failures not retried. AC: auth-failure source shows zero automatic retries.
- **T5.7 Supersession and account checks** (ADR-045): pending work verifies account active + input still relevant; suspended/closed stops work. AC: suspension mid-queue prevents new user-specific results.

## Phase 6 — Hybrid Evaluation

- **T6.1 Deterministic constraints first** (FR-4/6/7, ADR-002): explicit conflicts rejected; unknowns retained/labeled/penalized; AI output cannot override a constraint failure. AC: adversarial job text claiming eligibility cannot flip a deterministic rejection.
- **T6.2 Dimension scores and ranking** (FR-19/21/22): named dimensions; default weights; simple user priority controls; transparent penalties. AC: score explanation enumerates applied penalties.
- **T6.3 Evidence-linked explanations** (FR-20/23): claims tied to identifiable evidence; inferred/uncertain labeled; no fabricated requirements. AC: explanation validator rejects unsupported required-qualification claims.
- **T6.4 Evaluation snapshots** (ADR-013/040): immutable, tied to profile version + job observation + policy version; compatible-current-result selection. AC: superseded snapshot remains attributable; dashboard never presents incompatible evaluation as current.
- **T6.5 Bounded re-evaluation** (ADR-041/FR-24): material profile change re-evaluates only available, relevant, in-scope jobs; pending indicator shown. AC: out-of-scope/unavailable jobs untouched by profile change.

## Phase 7 — Dashboard

- **T7.1 Query/command boundary** (ADR-014): all reads/writes through user-scoped boundary; no direct record mutation from frontend. AC: isolation test suite across two accounts over the API surface.
- **T7.2 Job views** (FR-14–15/Flow 4): ranked new-jobs view; detail view with evidence, scores, eligibility state, links; save/not-interested lifecycle. AC: not-interested jobs never re-presented as new.
- **T7.3 Status truthfulness** (FR-10/Flows 3/5): last-completed run time; refresh pending/in-progress/partial/failed states. AC: partial run renders as partial.
- **T7.4 Disclosure flows** (FR-0a/ADR-035): activation notice; contextual pre-upload disclosure; acknowledgement gate on material changes; manual-profile path without resume. AC: declining resume upload leaves full manual flow functional.
- **T7.5 Closure flow** (FR-0b/ADR-036/Flow 7): warning, fresh passwordless confirmation, immediate access/work block, truthful deletion status. AC: stale session cannot confirm closure; confirmation link reuse fails safely.
- **T7.6 Search strategy controls** (FR-11–13): view/edit/disable generated terms; transparency of related-role expansion.

## Phase 8 — Operations

- **T8.1 Structured logging** (ADR-015/058): JSON logs with correlation/work-unit IDs; minimization enforced. AC: log-scan test over a full simulated user journey finds no resume/profile/job-text/AI-content strings.
- **T8.2 Health checks and alerts** (ADR-058): health endpoints; VM script checking containers/disk/PostgreSQL/daily-backup success; Resend alerts within amended ADR-052 scope. AC: induced backup failure generates alert; alert content contains no sensitive data.
- **T8.3 Backup pipeline** (ADR-057): daily encrypted dump → dedicated bucket; client-side encryption with Vault-held key; 90-day lifecycle; post-upload integrity check. AC: end-to-end backup verified; integrity-check failure path recorded.
- **T8.4 Restore runbook and deletion replay** (ADR-024/057): documented restore into isolated container; deletion-request replay step; monthly drill recording. AC: drill executed once with recorded outcome including deletion-replay proof.
- **T8.5 Retention enforcement** (ADRs 019–021): category schedules implemented (30-day resume grace, 180-day shared data, 90-day telemetry, 12-month audit, 24-month exceptional-access). AC: time-advance tests expire each category correctly.

## Phase 9 — Release-Validation Gate (ADR-030)

- **T9.1 Evidence checklist**: compile recorded evidence for every ADR-030 dimension (isolation, least privilege, identity lifecycles, exceptional access, retention/deletion, minimization, secrets absence, source/processor restrictions, untrusted-content resistance).
- **T9.2 Untrusted-content adversarial tests** (ADR-029): prompt-injection-style job descriptions and resume content attempting workflow/constraint/policy influence. AC: all attempts fail deterministically.
- **T9.3 Gate review**: decision-maker sign-off recorded; beta onboarding permitted only after sign-off.
