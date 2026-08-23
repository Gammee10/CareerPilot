# MVP System Architecture — Autonomous Job Search & Application Agent

## Status

Component-boundary decisions, the primary application-stack decision, the authoritative data-store decision, the durable-work mechanism decision, the artifact-storage boundary, the passwordless-identity implementation decision, the transactional-email provider decision, the cost-constrained hosting foundation, the backup/recovery-verification policy, the operational logging/monitoring/alerting baseline, the initial source portfolio and adapter limits, and the pre-onboarding OCI and Gemini processor reviews are accepted. This document records accepted system-architecture decisions.

## Accepted System Boundary Style

### Decision

The MVP shall be one modular system with explicit logical capability boundaries and two independently operable runtime roles:

- an interactive/control-plane role for authenticated user and administrator interactions; and
- a background-work role for durable asynchronous processing.

This is a component-boundary decision, not a decision to use independently deployable domain services. The two roles may share approved domain records, but each capability shall retain ownership of its responsibilities and shall communicate across the defined command, work, and record boundaries rather than bypassing them.

### Rationale

The MVP requires background work to continue after a user closes the dashboard and must prevent collection, resume processing, AI-assisted analysis, and re-evaluation from degrading interactive use. At private-beta scale, independently deployed business services would introduce distributed-systems and operational complexity before there is evidence that it is needed.

### Component Responsibilities

| Logical boundary | Responsibility |
|---|---|
| Web application / dashboard | Profile setup, resume-review workflow, search controls, job review, evidence display, manual-refresh requests, and truthful discovery/re-evaluation status. It does not synchronously collect or analyze jobs. |
| Authentication and invitation | Administrator-issued invitations, passwordless-link lifecycle, authenticated session identity, and access/isolation decisions. It does not own profile or job policy. |
| Profile and resume processing | Resume artifact intake, extraction drafts, user review/editing, career profile, immutable profile versions, and profile completeness. Only a user-approved profile version may be used for discovery or evaluation. |
| Discovery orchestration and scheduling | Per-user time-zone-aware daily runs, guarded manual refresh, discovery-run lifecycle, source-attempt coordination, partial/failure status, and duplicate-concurrent-run prevention. |
| Source-adapter layer | Authorized source-specific collection, terms and rate-limit enforcement, schema translation, and provenance capture. Individual adapters remain independently enableable, disableable, modifiable, and replaceable under ADR-001. |
| Normalization and deduplication | Common job representation, source-listing handling, conservative canonicalization, availability observations, material-change detection, and preferred/alternative application-link selection under ADR-004, ADR-006, and ADR-007. |
| Job analysis and matching | Deterministic hard-constraint and eligibility assessment; AI-assisted job interpretation and semantic matching; named dimensions, ranking, evidence, and uncertainty. A hard-constraint failure cannot be overridden by AI output. |
| Evaluation and explanation persistence | User-specific, versioned evaluations tied to the input profile version and job observation; eligibility state, scores, evidence, uncertainty, and evaluation lifecycle. |
| Background-work processing | Durable execution of resume extraction, collection, normalization, canonicalization, analysis, evaluation, re-evaluation, and availability work. It owns reliable execution concerns such as retries and idempotent handling, but not domain policy. |
| Observability and operations | Cross-cutting telemetry and audit records for discovery outcomes, source limitations, work failures/retries, latency, deduplication confidence, evaluation traceability, and isolation/security-relevant events. Sensitive resume and profile content must not be unnecessarily exposed. |
| Notifications | Out of scope for the MVP. The dashboard is the MVP status and results surface. |

### Conceptual Interaction

```text
Dashboard → authenticated commands → profile / discovery controls
                                     ↓
                          scheduler + background work
                                     ↓
source adapters → normalize/deduplicate → analyze/match
                                     ↓
        shared job records + user-specific evaluations/reviews
                                     ↓
                            dashboard read models
```

### Consequences

- Background work must be durably represented and observable rather than tied to an interactive request lifecycle.
- Capability contracts and ownership must remain explicit even if the MVP is initially delivered as one codebase.
- The architecture preserves a future option to extract a capability if measured scale, reliability, security, or team-boundary needs justify it.
- This decision does not authorize a shared source listing or canonical job record where a source contract prohibits it; source-specific compliance remains mandatory.

### Revisit Conditions

Reconsider this boundary style if private-beta usage demonstrates independent scaling, reliability, security, or ownership needs that cannot be met with modular boundaries and separately operable runtime roles; or if source licensing requires materially different data isolation.

## Accepted Authentication and Invitation Boundary

### Decision

Authentication and invitation management shall be a dedicated logical capability. It owns administrator-issued invitation lifecycle, passwordless access-link lifecycle, account and authenticated-session identity, and access/isolation decisions.

The web application consumes authenticated identity and presents the appropriate user or authorized-administration experience. Profile, resume, discovery, shared job, evaluation, and review capabilities shall not own authentication credentials, invitation validity, or session policy.

### Boundary Clarifications

- Access-link email delivery is required transactional authentication delivery under ADR-003. It is not an MVP product-notification capability.
- This decision does not select an identity provider, email-delivery provider, session mechanism, link-expiry duration, replay-protection design, or administrator interface.
- The capability must enforce the invite-only boundary and fail invalid, expired, or used links without disclosing another user's identity or data.

### Consequences

- Identity and authorization policy has a single logical owner, supporting individual-account isolation.
- Product capabilities receive an authenticated identity and enforce their own resource-level ownership checks rather than independently implementing sign-in behavior.
- Detailed transactional-authentication-delivery failure behavior remains an implementation and operational design concern. Access policy, administrator authorization, and authentication-event auditing are governed by ADRs 016 through 036.

## Accepted Durable Background-Work Coordination

Discovery and other long-running processing use durable, stateful workflow coordination across the background-work boundary. The discovery orchestration capability owns the authoritative lifecycle of a `Discovery Run`, including scheduled discovery, guarded manual refresh, and requests to re-evaluate active jobs after a relevant profile or search update. It submits independently executable work and records the resulting state; background-work processing executes those work units.

Logical work units include resume extraction, source collection attempts, normalization, deduplication, availability updates, job analysis and matching, and re-evaluation. `Source Collection Attempt` and other process records must accurately represent retries, partial completion, and failure. A failed source must not prevent usable work from other sources from reaching the user.

The design must make idempotency, retry handling, concurrency control, and run/status visibility explicit. In particular, a retry or overlapping trigger must not create duplicate user-visible jobs or evaluations. Manual refresh remains subject to the product's guardrails and must not bypass the normal run lifecycle. The dashboard reads the resulting process records to communicate meaningful status; it does not perform this background work itself.

This decision defines responsibilities and durability requirements only. It does not select a queue, workflow engine, scheduler, or hosting model.

## Accepted Source-Adapter Boundary

Each authorized source adapter owns source-specific collection: authorization and terms-aware access, rate limits, source schema interpretation, collection error reporting, and capture of source provenance. An adapter emits a source-specific observation that conforms to a shared source-listing contract; it does not create canonical jobs or own cross-source canonicalization.

The shared normalization capability validates and translates these observations into the common job representation and source-listing records. It retains the provenance required for evidence, availability history, and application-link selection, while enforcing any source-specific restrictions on retention, sharing, and display. The downstream deduplication capability then performs conservative canonicalization under ADR-004 and ADR-006.

This separation keeps source-specific compliance decisions localized and preserves consistent normalization and canonicalization across adapters. It does not authorize collection, retention, display, or downstream reuse beyond each source's permitted terms, and it does not select a source-provider or adapter implementation technology.

## Accepted Shared Job-Processing Pipeline

The shared job-processing pipeline has three explicit logical stages. They are component boundaries within the modular system, not separately deployed services:

1. **Normalization** validates a source observation and translates it into the common job and source-listing representation while preserving required provenance and source restrictions.
2. **Canonicalization** applies the layered, conservative matching policy of ADR-006 to associate a source listing with an existing canonical job or create a new canonical job. It records sufficient decision context to support review and correction.
3. **Availability processing** records source-listing availability observations and maintains derived canonical-job availability without interpreting a transient absence from a collection result as permanent removal.

Each stage has a distinct responsibility and persists an outcome that later stages may use. The separation makes data-translation, duplicate-resolution, and availability-state errors distinguishable and enables safe retry behavior under ADR-010. It does not change the canonical job, source listing, or application-link decisions in ADR-004 and ADR-007.

## Accepted Evaluation and Explanation Lifecycle

Matching produces immutable, versioned user-specific evaluation snapshots. Each snapshot is tied to the approved profile version, the relevant job or listing observation, and the matching-policy version that produced it. It persists the deterministic eligibility and hard-constraint outcome, ranking dimensions, supporting evidence, uncertainty, and AI-assisted interpretation necessary to explain the result under ADR-002.

A designated current evaluation, or an equivalent derived read model, is used for the dashboard. Re-evaluation creates a new snapshot rather than overwriting a prior result. This preserves what the user was shown and the basis for it when a profile, job, or matching policy changes. The evaluation lifecycle remains separate from the user's review state: saving or dismissing a job does not mutate the matching evidence or score.

This decision does not select a model, prompt, scoring algorithm, storage technology, or the exact policy-versioning mechanism.

## Accepted Dashboard Read and Command Boundary

The web application accesses MVP functionality through a dedicated application-facing query and command boundary. Queries return only the authenticated user's permitted view: user-scoped job-list and job-detail read models, the current evaluation and explanation context, review state, profile state, and truthful discovery or processing status. Shared job information is combined with the user's evaluation and review context before presentation, without exposing another user's records.

The dashboard submits authenticated commands for profile edits, manual-refresh requests, saved and not-interested actions, and use of external application links. It does not directly create or modify canonical jobs, source listings, discovery process records, or evaluation snapshots. Each command is subject to the responsible capability's ownership and policy checks.

This protects individual-account isolation and separates interactive UX concerns from background processing and internal record structures. It does not select an API style, framework, database, or independently deployed backend-for-frontend.

## Accepted Observability, Audit, and Sensitive-Data Boundary

Observability is a cross-cutting operational capability with structured, correlatable telemetry and a distinct audit-event model. Appropriate identifiers link material lifecycle events without copying their sensitive payloads: invitation and access events; discovery runs and source collection attempts; normalization, canonicalization, and availability outcomes; evaluation and re-evaluation creation; and user review actions.

Audit events record material security, isolation, administration, and user-impacting actions. Operational telemetry records the information needed to diagnose reliability, source coverage, latency, retries, deduplication outcomes, and evaluation traceability. It must support truthful dashboard status and operational investigation across both runtime roles.

Raw resume files, profile content, full job text, and AI inputs or outputs are excluded from routine telemetry and audit events by default. When limited diagnostic context is necessary, it must be minimized, redacted or summarized as appropriate, access-controlled, and governed by the applicable retention and source-use restrictions. Observability must not become an unprotected second copy of user or source data.

This decision does not select monitoring, logging, tracing, or audit products; retention durations; or implementation mechanisms.

## Accepted Authorization and Administrator-Access Policy

Authorization shall be deny-by-default and enforced at the resource level in addition to authenticated identity. An individual user may access and change only their own account-scoped profile, resume, search strategy, discovery status, evaluations, and review state. Shared job and source data may be presented only through that user's permitted dashboard context; it shall not be exposed as a general shared-data browsing capability.

Administrator authority shall be least-privilege and limited to defined operational functions: invitation issuance and revocation, account access-state management, authorized source and processing operations, and security or operational audit inspection. Administrator authority does not grant routine access to resume contents, career-profile contents, detailed evaluations, or user job-review history.

Exceptional access to user content may be permitted only for a defined support, security, or legal incident. Such access must be purpose-limited, time-bounded, attributable to a named administrator, and recorded as an audit event. Approval, user-notice, and retention policy are governed by ADRs 017, 021, 023, and 035; the exact content scope remains constrained by the defined incident purpose.

This decision does not select an authorization framework, identity provider, database enforcement mechanism, administrator interface, or implementation technology.

## Accepted Exceptional Administrator-Access Authorization

Planned exceptional access to user content requires authorization by an authorized administrator other than the administrator requesting access. The request and authorization must identify the purpose, intended scope, and time limit, and both identities must be audit-recorded.

For an urgent security incident, immediate exceptional access may occur when waiting for prior approval would materially impede containment, investigation, or protection of users or the service. The acting administrator must record the reason and scope at the time of access, and a different authorized administrator must conduct a prompt independent retrospective review. This emergency path must not be used for ordinary support convenience.

This decision assumes the beta can designate at least two authorized administrators or an independent reviewer. If that is not operationally possible, a separately approved, narrowly constrained single-administrator fallback is required; this decision does not imply that separation of duties exists when it does not.

The exact authorization-request form and review timing remain operational details. User-notice and authorization-record retention policy are governed by ADRs 021, 023, and 035.

## Accepted Passwordless Access-Link Security Policy

Passwordless invitation and sign-in links are security-sensitive bearer credentials. They shall use opaque, unguessable values; have a short validity period; and be redeemable only once. Opening a valid link shall present a confirmation step before the link is redeemed, so ordinary email-security scanning or previewing does not itself authenticate a session or consume the link.

Invalid, expired, used, or otherwise unacceptable links shall fail safely with a non-disclosing response that does not reveal account, invitation, or user-data information. Link issuance shall be subject to abuse controls, including rate limits, and material lifecycle events shall be audit-recorded. Issuing a new sign-in link for an account invalidates any prior unused sign-in link for that account. Invitation lifecycle remains distinct and is governed by the invitation policy.

This policy retains email-inbox control as the MVP possession factor. It does not select a second factor, identity provider, email provider, token format, session mechanism, expiry duration, rate-limit values, confirmation-interface design, or implementation technology.

## Accepted Data-Retention and Deletion Model

The MVP shall use category-based, lifecycle-bound retention rather than one universal retention rule. It shall retain data only while necessary for an active account, approved product behavior, security and operational obligations, or applicable source-use restrictions. Immutable profile and evaluation history may be retained while it supports the approved explainability and re-evaluation behavior; it is not an authorization for indefinite retention.

User-owned data, shared job and source data, authentication records, audit records, operational telemetry, and exceptional-access records shall each have an explicit retention and deletion lifecycle. Source-specific retention, display, sharing, and deletion restrictions take precedence where they are more restrictive. Account closure and user-requested deletion shall use a defined, bounded deletion lifecycle, subject only to separately defined legal or incident-preservation requirements.

Specific retention periods, deletion timing, recovery-copy treatment, and preservation-hold policy are governed by ADRs 020, 021, and 024.

## Accepted User-Owned Sensitive-Content Lifecycle

While an account is active, the system may retain the user's current raw resume and approved profile versions, evaluation snapshots, and review state for the approved profile, matching, explanation, and re-evaluation behavior. It shall not retain redundant raw resume artifacts indefinitely: a replaced or user-removed raw resume, and an abandoned resume-extraction draft, shall be deleted after a 30-day grace period.

On account closure or a valid deletion request, the system shall immediately disable access and delete user-owned data from active systems within 30 days. Protected recovery copies expire no later than 90 days after creation under ADR-024. Any legal or security-preservation hold must be explicit, purpose-limited, and separately governed; it is not a default exception to deletion.

This decision does not determine source-data, audit, telemetry, or authentication-record retention periods.

## Accepted Shared and Operational-Record Retention Schedule

Shared source listings, canonical-job details, and availability history shall be retained only until the sooner of the source's permitted maximum retention period or 180 days after their last observation. Authentication lifecycle metadata and routine audit events shall be retained for 12 months. Exceptional-access requests, approvals, access events, and retrospective reviews shall be retained for 24 months. Operational telemetry and traces shall be retained for 90 days.

Raw diagnostic material retained for an incident may exist only for that incident's defined scope and duration, and shall be deleted when it is no longer needed. All records remain subject to the sensitive-data minimization requirements of ADR-015. ADR-024 governs recovery-copy expiry and the preservation-hold process.

## Accepted Sensitive-Data Access and External-Processing Policy

Sensitive data access shall be purpose-scoped and limited to the minimum content needed for the responsible capability's approved function. The authentication and invitation capability accesses identity, invitation, and access-link records, not resume, profile, or evaluation content. Source adapters receive permitted search criteria but not raw resumes or unrelated evaluation history. Resume processing may access the submitted resume and relevant draft or profile context; matching may access the approved profile fields and job evidence needed for that evaluation only. Dashboard queries remain limited to the authenticated user's permitted view.

An external processor, if used for an approved function, may receive only the minimum necessary input for that function. It must not use the input for unrelated processing or model training, and it must be subject to the applicable access, retention, and deletion obligations. Administrator access remains governed by the exceptional-access policy, and telemetry remains subject to sensitive-data minimization.

This policy does not select external processors, contractual mechanisms, encryption mechanisms, data-transfer protocols, or implementation technology.

## Accepted Audit and Security-Incident Operating Model

Material audit events shall cover authentication, invitation, authorization, exceptional access, user-data lifecycle, source-policy, and user-impacting actions. Each event shall identify the actor or responsible capability, action, outcome, target category or identifier, authorization or declared purpose where relevant, timestamp, and correlation identifier, while excluding raw sensitive content by default.

Operations shall follow a defined lifecycle for a suspected security or isolation incident: record and classify it; contain active risk; preserve only minimum necessary evidence under a scoped hold; assess affected users, data categories, scope, and cause; remediate and recover; then complete a documented review. Containment may include revoking access, disabling a source, or suspending administrator authority where justified.

For confirmed unauthorized access to or disclosure of sensitive user data, affected users shall be notified without undue delay after sufficient information exists to provide a meaningful notice, unless a documented legal or security reason requires delay. This decision does not establish a full enterprise compliance program, a 24-hour operations commitment, specific incident-response time limits, or implementation tooling.

## Accepted Recovery-Copy and Preservation-Hold Policy

Recovery copies shall expire no later than 90 days after creation. After deletion from active systems, user data shall be inaccessible and may remain only in protected recovery copies until their normal expiry. If recovery restores a copy containing data covered by a valid deletion request, the deletion shall be re-applied.

A preservation hold may be created only for a defined security incident or specific legal obligation. It must have a named owner, restricted data scope, documented justification, expiry or review date, and audit record. A hold does not grant additional access rights, cannot be blanket or indefinite, and cannot be used for ordinary operational convenience.

This policy does not select backup technology, recovery procedures, legal advice, or implementation tooling.

## Accepted Invitation and Account-State Lifecycle

Invitation lifecycle states are `issued`, `accepted`, `expired`, and `revoked`. An invitation is bound to its invited email address; changing the recipient requires revocation and re-issuance. Account lifecycle states are `active`, `suspended`, and `closed`.

Only an active account may authenticate or receive scheduled discovery and re-evaluation work. Suspending an account immediately blocks new sessions and pauses user-specific background work while retaining data under the approved retention policy. Closing an account immediately blocks access and starts the 30-day active-system deletion lifecycle. A closed account is not reopened; renewed access requires a new invitation and account rather than reversal of deletion processing.

Invitation issuance, expiry, revocation, acceptance, account suspension or restoration, and closure are material audit events. Validity periods and issuance limits are governed by ADR-026.

## Accepted Passwordless-Link Validity and Issuance Limits

A sign-in access link shall expire 15 minutes after issuance. An invitation shall expire 14 days after issuance unless accepted or revoked earlier. Sign-in-link requests for an invited email shall be limited to three requests per 15-minute interval and ten requests per 24-hour interval. Rate-limit responses shall remain non-disclosing.

An expired invitation may be re-issued, and an administrator may revoke and re-issue an invitation at any time. These limits do not alter the one-time redemption, confirmation-before-redemption, or prior-unused-sign-in-link invalidation requirements of ADR-018.

## Accepted Authenticated-Session Lifetime and Revocation Policy

An individual user's authenticated session has a 30-day absolute lifetime and expires after seven days of inactivity. An administrator's authenticated session has a 12-hour absolute lifetime and expires after one hour of inactivity. A new passwordless link is required after expiry or revocation.

All sessions shall end immediately when the associated account is suspended or closed, when administrator authority is removed or suspended, or when incident containment requires revocation. Session creation, revocation, and privileged-session expiry are material audit events; ordinary user-session expiry need not create noisy audit events.

This is a security-policy decision only and does not select session storage, token format, identity technology, or implementation mechanisms.

## Accepted External-Credential and Secret-Governance Policy

Secrets and external credentials are a distinct security-governed data class. They shall be available only to the runtime capability that requires them; source-adapter credentials shall not be available to unrelated capabilities. Credentials shall be unique and scoped per external integration and operational environment where possible, and shall not be casually shared or reused.

Secrets shall not appear in source code, user-facing responses, telemetry, audit events, or ordinary diagnostics. Credential issuance, rotation, revocation, access-policy changes, and suspected compromise are material security events. Suspected compromise requires prompt revocation or rotation and, where necessary, disabling the affected integration until safe operation resumes. Third-party credentials do not expand the purpose-scoped user-data access policy.

This decision does not select secret-storage products, deployment products, key-management systems, or implementation mechanisms.

## Accepted Untrusted-Content and AI-Processing Boundary

Source listings, imported job URLs, resumes, and extracted text shall be treated as untrusted evidence, not executable instructions. No such input may alter authorization, access scope, source policy, retention, workflow routing, hard constraints, or external actions. Only system-defined policies and commands control these behaviors.

AI-assisted output is an untrusted proposed interpretation. It shall be constrained to the requested task, validated against the expected structure, and combined with deterministic policy before persistence or presentation. AI output cannot independently create invitations, change profiles, trigger broader data access, bypass source limits, or submit an application. Evidence and uncertainty requirements remain mandatory; unsupported AI claims shall not be presented as confirmed facts.

This decision does not select an AI provider, model, prompt format, validation library, or implementation technology.

## Accepted Security and Privacy Release-Validation Gate

Before initial private-beta onboarding, the system shall undergo a focused architecture and security review. A material change to authentication, authorization, sensitive-data processing, external processors, source policy, or retention shall repeat the relevant risk-based validation before release.

Validation must provide evidence that the relevant change preserves unauthenticated denial, user-to-user isolation, administrator least privilege, invitation/link/session/suspension/revocation behavior, exceptional-access authorization and auditability, retention/deletion/recovery-copy/preservation-hold behavior, telemetry and audit minimization, absence of secrets from routine diagnostics, source and external-processor restrictions, and resistance to adversarial untrusted-content attempts to influence AI interpretation or workflow behavior.

This decision does not select testing frameworks, security vendors, external-audit providers, or implementation tooling.

## Accepted Administrator-Role Lifecycle Control

Administrator-role assignment, removal, or privilege alteration requires dual control: one authorized administrator initiates the change and a different authorized administrator approves it. No person may approve their own elevation or privilege change. Initial bootstrap authority must be explicitly documented and audit-recorded.

The final active administrator shall not be removed until a replacement is active. Administrator-role assignment, removal, and attempted self-escalation are material audit events. The emergency exceptional-access path does not permit emergency self-granting of administrator authority.

This decision assumes at least two authorized administrators or an independent reviewer. It does not select an administrator interface, identity provider, or implementation mechanism.

## Accepted Confidentiality and Integrity Protection Boundary

Sensitive user data, credentials, and security records shall receive confidentiality and integrity protection both in transit between approved boundaries and at rest while retained. This includes resumes, profiles, evaluations, authentication and session records, audit and exceptional-access records, credentials, and retained sensitive incident diagnostics. Shared source data shall receive protection appropriate to its source restrictions and sensitivity.

Cryptographic-key access shall be restricted separately from ordinary application access and limited to the minimum components or roles that require it. Keys shall not appear in routine logs, audit events, or source code. Exact algorithms, key-management systems, rotation intervals, infrastructure products, and implementation mechanisms remain open.

## Accepted External-Processor Approval Gate

Before an external processor receives user or source data, it requires a documented review and explicit decision-maker approval. The review shall cover the approved purpose, minimum necessary data categories, applicable source restrictions, prohibition on training or unrelated reuse, retention and deletion, security commitments, subprocessors, incident obligations, and termination or offboarding behavior.

This gate applies again before materially expanding an existing processor's data scope or purpose. It authorizes neither a provider nor any data transfer by itself, and it does not select contractual mechanisms, providers, or implementation technology.

## Accepted Cross-Border Processing and Data-Residency Posture

The MVP makes no country-specific data-residency promise. Cross-border processing is permitted only through approved processors and approved processing arrangements, with documented processing locations as part of the external-processor approval gate. The product shall disclose this posture to users before they provide sensitive content.

This decision is a product and data-governance posture, not legal advice or a determination of applicable law. Applicable obligations must be validated before onboarding users or processors. It does not select hosting regions, providers, or contractual mechanisms.

## Accepted User Data-Use Transparency and Acknowledgement

The product shall provide layered, plain-language data-use disclosure: an account-activation notice and contextual disclosure before resume upload or a newly introduced external-processing purpose. A user shall acknowledge material changes before using the affected feature. A user who declines resume upload may still complete a profile manually.

The disclosure shall explain the processed career and job data and their purposes; that user-approved profile data drives discovery and matching; the retention and deletion posture and how to request closure or deletion; approved cross-border and external-processing posture when applicable; the no-routine-administrator-access rule and tightly controlled exceptional-access policy; and how to report concerns or request support.

This is a transparency and acknowledgement decision, not legal advice or selection of consent-management technology.

## Accepted Account-Closure and Deletion-Request Path

Only an account owner may self-initiate account closure and deletion. The dashboard shall present a clear impact warning and require confirmation through a newly redeemed passwordless link for that account. On confirmation, access and user-specific background work stop immediately and the approved deletion lifecycle begins. The user shall receive confirmation and truthful deletion-status information.

An administrator may suspend access for operations or security. An administrator may close an account only for a documented user request, legal obligation, or security reason, with an audit record. No self-service cancellation is available after closure confirmation, consistent with the non-reopening rule for closed accounts.

This decision does not select interface, notification-delivery, authentication, or implementation technology.

## Accepted Immutable Source-Listing Observation and Current-View Policy

Each source-adapter collection result is an immutable, provenance-preserving source-listing observation. Current source-listing and canonical-job views are derived from the latest relevant observations rather than destructively replacing past evidence. Each evaluation references its exact input observation or canonical-job version; material changes may trigger availability processing and re-evaluation under existing workflow policy.

Observation retention remains subject to source restrictions and the shared-data lifecycle in ADR-021. This policy does not select storage, event, versioning, or workflow technology.

## Accepted Non-Destructive Canonical-Job Reconciliation Policy

Canonical-job merge and split decisions shall be non-destructive and evidence-backed. They retain affected identities and source observations, record supporting evidence and current relationships, and do not rewrite historical evaluations or user reviews. The dashboard resolves reconciled identities consistently; uncertain candidates remain separate until adequate evidence exists.

This policy does not select identifiers, data-store relations, reconciliation algorithms, or implementation technology.

## Accepted Relevance-Based Material Job-Change Processing

The system shall classify source-observation changes by their potential effect on eligibility, matching, availability, or the preferred application link. A material change triggers the applicable current-view update, availability processing, and immutable re-evaluation; non-material changes may update evidence or presentation without automatic re-evaluation. User review state remains intact and a material update may be shown as updated.

This policy does not define comparison algorithms, queues, scheduling mechanisms, or implementation technology.

## Accepted Current Dashboard-Result Selection Policy

For a user and job, the dashboard's current result is the newest successful evaluation compatible with the user's current approved profile and current material job evidence. Earlier immutable snapshots remain attributable to their original inputs. If no compatible successful evaluation exists, the dashboard shall not imply that a current personalized result exists.

This policy does not select query mechanisms, data-store views, caching, or implementation technology.

## Accepted Bounded Re-evaluation After Material Profile Change

A material approved profile change triggers new immutable evaluations only for currently available, relevant jobs in that user's active discovery scope. Historical, unavailable, and out-of-scope jobs are not automatically re-evaluated solely because of that change. The dashboard applies the compatible-current-result policy during processing.

This policy does not define the exact relevance calculation, scheduling mechanism, work queue, or implementation technology.

## Accepted Per-User Discovery-Request Coalescing

Only one discovery run may be active for a user. Overlapping scheduled, manual, and material-profile-change requests are coalesced into at most one follow-up run, using the latest approved profile and active discovery scope when it starts. Run records preserve sufficient initiating and coalesced reasons for truthful user status and operations.

This policy does not select queues, locks, schedulers, concurrency primitives, or implementation technology.

## Accepted Partial Discovery-Run Result Policy

A discovery run may complete partially. A failed, rate-limited, or partial source attempt does not discard usable results from other authorized sources. Each attempt records its outcome, timing, and relevant scope metadata; dashboard and operational status must not represent partial coverage as complete. Successful observations continue through the established processing stages.

This policy does not select retry algorithms, queues, monitoring products, or implementation technology.

## Accepted Source-Collection Retry and Recovery Policy

Source collection shall use bounded, source-policy-aware retry within the current discovery run. Only clearly transient failures are eligible for automatic retry, within each source's configured attempt and time budget. Source-provided retry timing and rate limits must be honored. Authorization, source-policy, invalid-request, and other non-transient failures shall not be retried automatically.

If collection cannot recover within the run's bounds, the attempt records the applicable failed, rate-limited, or deferred outcome and the discovery run may complete partially under ADR-043. A later scheduled or permitted manual discovery run may attempt the source again under its policy. Retries must preserve idempotent processing and must not create duplicate source observations or user-visible evaluations.

This policy does not select retry counts, backoff calculations, queueing, scheduling, or implementation technology.

## Accepted Background-Work Idempotency and Supersession Policy

Each background-work unit shall identify its immutable input and its logical idempotency identity. Re-delivery of the same logical work must produce at most one persisted outcome for those inputs; distinct valid re-evaluations remain separate immutable outcomes. Before pending work begins, it shall verify that the associated account remains active and that its input is still relevant. Pending work superseded by a newer approved profile or material job evidence may be skipped when it cannot produce a current result.

Newer profile or job evidence does not require cancellation of already-running work. Work that validly completes may persist its historical immutable outcome, while ADR-040 prevents an incompatible evaluation from being presented as current. Suspension or closure stops pending user-specific work and prevents creation of new user-specific results. ADR-042 remains the mechanism for coalescing a subsequent discovery run using the latest approved profile and active scope.

This policy does not select idempotency-key formats, locking, cancellation mechanisms, queues, schedulers, or implementation technology.

## Accepted Evidence-Weighted Job-Availability Policy

An explicit authoritative source signal that a listing is closed or removed shall mark that listing unavailable. Mere absence from a collection result shall not by itself mark a listing or canonical job unavailable. If an active listing has no confirming observation beyond its source-specific freshness window, its availability shall become stale or uncertain rather than remain represented as confirmed active. A later active observation restores active status.

The dashboard ranks only jobs believed active by default. Saved or historical unavailable, stale, or uncertain jobs remain retained and truthfully labeled under the existing listing-lifecycle requirement. This policy applies alongside the immutable-observation, derived-current-view, and partial-run rules in ADRs 037 and 043.

This policy does not select freshness-window values, availability algorithms, queries, schedulers, or implementation technology.

## Accepted Primary Polyglot Application Stack and AI Capability Boundary

The MVP shall use Next.js with TypeScript for the frontend, Node.js with TypeScript and Express for the authoritative application backend, and FastAPI with Python for a narrowly scoped internal AI-processing capability.

The Express backend owns the application-facing query and command boundary, authentication integration, discovery orchestration, source adapters, normalization, canonicalization, user-specific state, and persistence coordination. Next.js owns dashboard presentation and interaction; it does not run durable collection, evaluation, or other long-running background work.

FastAPI is internal and non-public. It may perform approved resume extraction and job interpretation or matching tasks using purpose-scoped inputs. It returns structured proposed interpretations to the Node-owned background-work path. It shall not directly authenticate users, own workflow state, write authoritative records, bypass Node-side validation or deterministic policy, or receive broader data than required for its task. This preserves the existing sensitive-data and untrusted-AI boundaries.

The architecture retains the accepted interactive/control-plane and background-work logical roles. FastAPI is an internal capability used by background work, not a separately owned domain service or public application backend. Durable workflow coordination is not implemented through request-tied FastAPI background tasks and remains a separate technology decision.

This decision does not select a database, object storage, queue or workflow mechanism, identity or email provider, hosting, external AI provider, model, observability product, or deployment product.

## Accepted Authoritative System-of-Record Database

PostgreSQL shall be the sole authoritative system of record for the MVP's account state, immutable profiles and evaluations, source-listing observations, canonical jobs and reconciliation records, availability history, discovery runs and attempts, user review state, audit metadata, and idempotency records. Related authoritative state changes shall use its transactional consistency guarantees.

Where source restrictions permit, flexible source-specific evidence and normalized fields may be retained in PostgreSQL `jsonb` fields alongside the relational model. This does not introduce a second document database. Raw resumes and other large artifacts remain outside PostgreSQL and require separately approved object storage.

This decision does not select a PostgreSQL provider, version, schema or migration tooling, connection-management mechanism, object-storage provider, backup product, or implementation library.

## Accepted Durable Background-Work Mechanism

The Node-owned background-work role shall use `pg-boss` backed by the approved PostgreSQL system of record for durable job execution. It shall execute independently from interactive requests and coordinate the approved discovery, source collection, processing, re-evaluation, retry, and recovery behavior. Authoritative `Discovery Run`, source-attempt, and other domain process records remain explicit PostgreSQL records; queue delivery does not replace those records or their user-facing status semantics.

Node remains the owner of work orchestration, idempotency, supersession checks, and authoritative persistence. It may invoke the internal FastAPI capability for purpose-scoped AI processing, but FastAPI does not own or schedule durable jobs. `pg-boss` configuration must implement the already approved source-policy-aware retry, coalescing, partial-result, suspension/closure, and idempotency rules; those policies are not delegated to library defaults.

This decision does not select a PostgreSQL provider, worker-hosting model, queue configuration values, monitoring product, or implementation code.

## Accepted Sensitive Artifact-Storage Boundary

Raw resumes and other large user-owned artifacts shall be stored in private, S3-compatible object storage rather than PostgreSQL. PostgreSQL retains only the artifact metadata and object reference needed for approved workflows and lifecycle management. Objects shall be encrypted at rest, transferred over protected connections, and accessible only through short-lived, purpose-scoped upload or download authorization.

The selected object-storage provider must support the approved confidentiality, integrity, deletion, recovery-copy, and access-control requirements and must pass ADR-033's external-processor approval gate before receiving user data. The object-storage interface shall remain S3-compatible to preserve provider portability.

This decision does not select an object-storage provider, region, encryption or key-management product, upload/download implementation, retention configuration, or deployment product.

## Accepted Passwordless Identity Implementation

The Node.js/Express authentication and invitation capability shall implement the MVP's passwordless identity lifecycle using PostgreSQL rather than delegate its security policy to a managed identity provider. It owns invitation issuance and revocation, opaque one-time access-link issuance, confirmation before redemption, session lifecycle, suspension/closure revocation, and the applicable audit records under ADRs 018 and 025 through 027.

A separate transactional-email provider may deliver the resulting messages but does not own identity, invitation validity, access-link redemption, account state, or session policy. The implementation remains subject to the approved security and privacy release-validation gate.

This decision does not select an email provider, token format, cryptographic library, session mechanism, email template, or implementation code.

## Accepted Transactional Email Provider and Scope

Resend is approved as the transactional-email processor only for invitation, sign-in, fresh deletion-confirmation, and essential account-lifecycle email delivery. It may receive only the recipient email address, minimum message metadata and content, and the opaque passwordless URL necessary for that delivery. It shall not receive resumes, profiles, job data, evaluations, or detailed audit content.

Open and click tracking shall remain disabled. Delivery, bounce, and failure events may be received through authenticated provider webhooks for operational status. Resend credentials shall be restricted to the authentication and transactional-email delivery capability. Any material expansion of Resend's data scope or purpose requires a new ADR-033 review and approval.

This decision does not select the email template implementation, DNS provider, webhook implementation, or deployment product.

## Accepted Cost-Constrained Private-Beta Hosting Foundation

The private beta shall use Oracle Cloud Always Free as its $0 hosting foundation. One Always Free Arm virtual machine shall run the containerized Next.js frontend, Express backend, Node background worker, internal FastAPI capability, and self-managed PostgreSQL. OCI Object Storage shall provide the approved private S3-compatible artifact storage.

This is a cost-constrained private-beta deployment posture, not a production availability promise. The team owns PostgreSQL operations, recovery verification, container deployment, host hardening, and operational monitoring on this single VM. The design preserves a later move of the same containers and PostgreSQL/S3-compatible boundaries to managed infrastructure when budget and operating requirements justify it.

Before onboarding, the approved Oracle processing region and services must be recorded through ADR-033's processor review, including the no-residency-promise disclosure. Usage must remain within Always Free limits; capacity shortage, idle-instance reclamation, or a need to exceed those limits requires an explicit hosting review rather than silent paid usage.

This decision does not select the OCI region, VM operating system, container runtime, deployment automation, backup implementation, monitoring product, or external AI provider.

## Accepted Unpaid Gemini AI Processing with Explicit Data-Minimization Boundary

Gemini API's unpaid tier is approved only for the internal FastAPI capability's purpose-scoped resume-extraction and job-interpretation/matching tasks during the $0 private beta. The Node-owned background-work path shall construct each task-specific minimized request before FastAPI calls Gemini and redact those items if embedded in otherwise relevant source text. It shall never send user IDs, names, email addresses, phone numbers, account identifiers, authentication data, resume filenames, direct profile URLs, or other unnecessary identifying metadata. It shall send only the candidate or job information required for that task, avoiding raw resumes or files whenever minimized text or structured task input suffices.

The mapping between any provider request or output and a CareerPilot account, profile, evaluation, or internal identifier remains entirely within CareerPilot; it is absent from provider-visible payloads and provider-facing logs. Gemini output remains an untrusted structured proposal: Node-side validation and deterministic policy control any authoritative persisted result. Gemini grounding, file upload, tuning, and other features that expand provider data use are out of scope unless separately reviewed and approved under ADR-033.

This boundary minimizes unnecessary exposure but does not make the content anonymous, private, or equivalent to a paid/private AI service. Gemini's unpaid-tier data-use policy remains an explicit, disclosed residual risk: provider use and possible human review of submitted content and generated responses are accepted solely for this constrained private beta. Before data is sent, users must receive clear transparency about that processing. Material changes to provider terms, task scope, or data categories require a new ADR-033 review and approval.

## Accepted Single-VM Container Deployment Baseline

The approved OCI Always Free VM shall run Ubuntu Server LTS. The Next.js frontend, Express backend, Node background worker, internal FastAPI capability, and PostgreSQL shall run as containers managed by Docker Compose. Caddy shall be the sole public HTTPS reverse proxy, exposing only approved public frontend and application endpoints. PostgreSQL, the Node worker, and FastAPI remain private to the VM/container network and receive no direct public route.

The Compose definition, image versions, configuration, and deployment procedure are version-controlled operational artifacts subject to the security/privacy release gate. This is a single-VM private-beta deployment baseline, not a high-availability, autoscaling, or zero-downtime design. It does not select a domain/DNS provider, CI/CD product, monitoring product, backup implementation, container registry, or image versions.

## Accepted Production-Secrets Boundary

OCI Vault shall be the source of truth for private-beta production secrets. Approved deployment or rotation procedures retrieve them and inject each secret only into the required container as a file-mounted Docker Compose secret. Secrets shall never be committed, baked into images, persisted in application configuration files, or passed through broadly inherited container environment variables.

OCI Vault and mounted-secret access are capability-scoped under ADR-028. The public frontend receives no server-side secrets; FastAPI receives no credentials unrelated to approved AI work. Rotation, revocation, audit, and exposure response follow the established credential governance, incident, and release-gate decisions. This does not select retrieval scripts, OCI identity-policy details, secret names, rotation intervals, or CI/CD.

## Accepted Backup and Recovery-Verification Policy

The private beta shall protect the authoritative PostgreSQL system of record with one encrypted logical backup (`pg_dump`, custom format) per day, encrypted on the VM before upload to a dedicated private OCI Object Storage backup bucket that is distinct from the resume/artifact bucket (ADR-057). Backup files shall expire through bucket lifecycle rules no later than 90 days after creation, consistent with ADR-024. Each backup's integrity shall be automatically verified after upload, with outcomes recorded as minimized operational telemetry. A documented restore drill shall be performed at least monthly into an isolated container, including verification that valid deletion requests are re-applied when restoring from a pre-deletion backup; drill outcomes are audit-recorded operational events. The restore runbook is a version-controlled operational artifact subject to the security/privacy release-validation gate.

Backup encryption keys are capability-scoped production secrets held in OCI Vault (ADR-056). Secrets are never backed up. No second backup pipeline exists for artifact objects in the beta; provider durability of the primary artifact bucket is accepted. The effective recovery point objective is 24 hours; a missed daily backup widens it and must be observable through operational status. Point-in-time recovery via WAL archiving is explicitly not provided in the beta and requires an explicit hosting or reliability review to introduce.

## Accepted Operational Logging, Monitoring, and Alerting Baseline

The private beta uses a self-hosted, single-VM, file-based observability baseline (ADR-058). Both Node runtime roles and FastAPI emit structured JSON logs with correlation and work-unit identifiers to captured local files under Compose-managed rotation, subject to ADR-015 minimization and ADR-021's 90-day telemetry retention bound. Each container exposes a lightweight health endpoint; a scheduled health-check script verifies container state, disk space, PostgreSQL reachability, and daily-backup success per ADR-057, recording outcomes as telemetry events and surfacing truthful operational status. Essential administrator-facing alert emails — missed/failed backup, repeated container restarts, disk threshold, restore-drill due or failed — are delivered through Resend within its amended scope (ADR-052). No metrics stack, tracing, APM product, or external log service is used in the beta; total VM failure is not self-reporting and is covered by periodic human verification. Any external monitoring processor requires an ADR-033 review before adoption.

## Accepted Initial Source Portfolio and Adapter Limits

The MVP's initial authorized automated sources are Greenhouse (public boards API), Lever (public postings API), and RemoteOK (public posting API), alongside the already-approved user-mediated URL import path (ADR-059). LinkedIn, Indeed, unvalidated aggregators, and HTML scraping remain excluded. Each source must pass its own documented ADR-033 review of current terms, attribution, retention, display restrictions, and rate expectations before first use; this portfolio selection does not pre-validate any individual provider. Adapters operate under conservative default limits — daily scheduled collection within discovery runs, approximately 6-hour manual-refresh minimum interval coalesced under ADR-042, fixed rate limits near one sustained request per second with `Retry-After` honored, a bounded result-page budget per query, and short-timeout, at-most-three-attempt retry for clearly transient failures under ADR-044. Retention and display follow ADR-021 and any stricter confirmed source limits. Limit values are operationally tunable within source policy without reopening this decision.

## Completed Processor Onboarding Reviews (ADR-033)

The pre-onboarding processor reviews required by ADRs 053 and 054 are completed and recorded in ADR-060. OCI processing is approved in the US East (Ashburn) home region for Compute, Object Storage (artifact and backup buckets), Vault, and supporting networking, with Always Free reclamation/capacity/limit risks recorded and silent paid usage prohibited; no data-residency promise is made. Gemini's unpaid-tier scope and terms are confirmed per ADR-054's minimized boundary, with provider data use and possible human review remaining an explicitly disclosed, accepted residual risk, and any material terms/task/data-category change halting submission pending re-review. Current Gemini terms text must be verified at implementation time; deviations trigger re-review rather than silent continuation.

## Remaining Pre-Implementation Items

No architectural decisions remain open. Two verification items must be completed at implementation start before related features operate on real data: (1) each authorized source's current-API-terms validation recorded before its adapter's first use (ADR-059); (2) confirmation that current Gemini unpaid-tier terms match the ADR-060 record, with any deviation halting AI processing pending re-review.
