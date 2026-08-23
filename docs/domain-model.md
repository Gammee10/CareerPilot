# MVP Domain Model — Autonomous Job Search & Application Agent

## Status

Accepted MVP domain-model specification. Technology-specific data design (schema details, migrations) is delegated implementation work within the accepted boundaries (ADR-048; AGENTS.md Implementation Freedom), not an open architectural decision.

## Approved Core Job Model

| Concept | Responsibility | Ownership |
|---|---|---|
| Job Source | Represents an authorized external source and its collection policy | System |
| Source Listing Observation | An immutable, source-specific collection result including provenance, source fields, and application URL | Shared system data |
| Current Source Listing | A derived current view of the latest relevant observations for one source-specific listing | Shared system data |
| Canonical Job | A derived current normalized view of one opportunity across one or more source listings | Shared system data |
| Job Availability History | Records observations of whether a canonical job is believed active, closed, removed, stale, or uncertain | Shared system data |
| User Job Evaluation | A user's score dimensions, eligibility assessment, explanation, evidence, and uncertainty for a canonical job | User-specific |
| User Job Review | A user's new/seen/saved/not-interested state for a canonical job | User-specific |

### Approved relationships

```text
Job Source 1 ── * Source Listing * ── 1 Canonical Job
Canonical Job 1 ── * Job Availability History
User 1 ── * User Job Evaluation * ── 1 Canonical Job
User 1 ── * User Job Review * ── 1 Canonical Job
```

Source-listing observations are immutable evidence and provenance; they do not belong to a particular user. Current source-listing and canonical-job views are derived from the latest relevant observations. Evaluations and review decisions do belong to a particular user.

## Approved Profile and Evaluation Versioning

| Concept | Responsibility | Ownership |
|---|---|---|
| Career Profile | The user's current editable career and preference configuration | User-specific |
| Profile Version | An immutable snapshot created whenever the user saves a profile change | User-specific |
| Resume Document | The uploaded resume artifact | User-specific |
| Resume Extraction Draft | Extracted, reviewable candidate profile data; never authoritative until the user saves it | User-specific |
| Evaluation Input Snapshot | Records the profile version and job observation used for an evaluation | User-specific evaluation record |

Every user job evaluation shall reference the profile version and exact source-listing observation or canonical-job version used to produce it.

The dashboard's current result is the newest successful evaluation compatible with the user's current approved profile and current material job evidence. Earlier snapshots remain attributable to their original inputs. If no compatible successful evaluation exists, the dashboard shall not imply that a current personalized result exists.

A material approved profile change triggers new evaluations only for currently available, relevant jobs in that user's active discovery scope. Historical, unavailable, and out-of-scope jobs are not automatically re-evaluated solely because of the profile change.

## Approved Canonicalization Policy

Canonicalization shall use layered, conservative matching. The system may automatically merge source listings only when a strong shared identifier or high-confidence evidence indicates the same opportunity. It shall retain uncertain matches as separate candidates and preserve every source listing's provenance.

Canonical-job reconciliation is non-destructive and evidence-backed. A merge or split retains the affected canonical-job identities and source-listing observations, records its supporting evidence and resulting current relationship, and does not rewrite historical evaluations or user reviews. Current dashboard views resolve reconciled identities consistently; uncertain cases remain separate.

## Approved Application-Link Policy

Each canonical job may retain multiple application links through its source listings. The product shall select a preferred primary link by favoring the employer's official ATS or career-site link when available, otherwise the best current authorized source link. Alternative current links remain available in the job-detail view.

## Discovery and Personalization Concepts

| Concept | Responsibility | Ownership |
|---|---|---|
| Search Strategy | Current enabled, profile-derived and user-edited search terms and source targeting | User-specific |
| Discovery Run | A scheduled or manual attempt to discover and evaluate jobs for one user and one profile version | User-specific process record |
| Source Collection Attempt | The per-source outcome within a discovery run, including query, timing, limits, and failure/partial status | Discovery-run record |
| User Job Evaluation | Versioned personalized evaluation of a canonical job against a profile version | User-specific |
| AI Processing Request | Ephemeral, task-specific minimized candidate or job content sent to the approved AI processor; contains no CareerPilot user/account/evaluation identity mapping | Internal processing only |
| Eligibility Assessment | Explicitly records confirmed, unverified, or conflicting eligibility and supporting evidence | Part of user evaluation |
| Score Explanation and Evidence | Dimension results, strengths, gaps, uncertainty, and job evidence used to support claims | Part of user evaluation |
| User Job Review | User-specific relationship to a job used for new/seen/saved/not-interested state | User-specific |

Only one discovery run may be active for a user. Overlapping scheduled, manual, or material-profile-change requests are coalesced into at most one follow-up run, which uses the latest approved profile and active discovery scope when it starts. A run records sufficient initiating and coalesced reasons for truthful status.

Each discovery-run work unit records immutable inputs and a logical idempotency identity. Re-delivery of the same logical work produces at most one persisted outcome for those inputs; distinct valid re-evaluations remain separate immutable outcomes. Pending work verifies that the account remains active and may be skipped when superseded by newer approved profile or material job evidence that cannot produce a current result. Validly completed in-flight work may remain historical evidence; an incompatible evaluation is not current under ADR-040. Suspension or closure stops pending user-specific work and prevents new user-specific results.

An AI Processing Request is not an authoritative domain record and does not carry the mapping to the user, account, profile, or evaluation that caused it. CareerPilot maintains that mapping only internally. Provider input is task-specific minimized candidate or job information and excludes those identifiers even if embedded in otherwise relevant source text: user IDs, names, email addresses, phone numbers, account identifiers, authentication data, resume filenames, direct profile URLs, and other unnecessary identifying metadata. AI output remains an untrusted proposed interpretation until the Node-owned path validates it and persists any approved evaluation snapshot.

A discovery run may complete partially. A failed, rate-limited, or partial source collection attempt does not discard usable observations from other sources. Each attempt records its outcome, timing, and relevant scope metadata; user-facing status shall not represent partial coverage as complete. Only clearly transient source-collection failures may be retried automatically, within the source's configured attempt and time budget and while honoring source-provided retry timing and rate limits. Non-transient authorization, source-policy, and invalid-request failures are not automatically retried. A bounded unrecovered attempt records its failed, rate-limited, or deferred outcome; a later scheduled or permitted manual run may try again under source policy. Retries must not duplicate source observations or user-visible evaluations.

### Approved relationships

```text
User 1 ── 1 Current Career Profile ── * Profile Version
User 1 ── 1 Current Search Strategy ── * Search Term
User 1 ── * Discovery Run ── 1 Profile Version
Discovery Run 1 ── * Source Collection Attempt
Discovery Run 1 ── * User Job Evaluation * ── 1 Canonical Job
User 1 ── * User Job Review * ── 1 Canonical Job
```

## Approved User Job Review Lifecycle

```text
New → Seen → Saved
          └→ Not interested
```

`Unavailable` is a shared canonical-job availability state, not a user-review state. A material job update may be surfaced as updated without removing a user's saved or not-interested state.

## Accepted Material Job-Change Processing

The system shall classify source-observation changes by their potential effect on user-facing results. A change that could affect eligibility, matching, availability, or the preferred application link is material and triggers the applicable current-view update, availability processing, and re-evaluation. Other changes may update evidence or presentation without automatic re-evaluation. Each re-evaluation creates a new immutable snapshot and preserves user-review state.

## Accepted Evidence-Weighted Availability

An explicit authoritative source signal that a listing is closed or removed marks the listing unavailable. Mere absence from a collection result never marks a listing or canonical job unavailable by itself. An active listing without a confirming observation beyond its source-specific freshness window becomes stale or uncertain; a later active observation restores active status. The dashboard ranks only jobs believed active by default, while saved or historical unavailable, stale, and uncertain jobs remain retained and truthfully labeled.

## Accepted Account, Access, and Governance Concepts

| Concept | Responsibility | Ownership |
|---|---|---|
| Account | Represents an individual user's access lifecycle: active, suspended, or closed | User-specific / system access policy |
| Invitation | Records an invitation bound to an email and its issued, accepted, expired, or revoked lifecycle | Authentication and invitation |
| Authenticated Session | Represents a bounded authenticated access session and its expiry or revocation state | Authentication and invitation |
| Administrator Role Change | Records a dual-controlled administrator-role assignment, removal, or privilege change | Administration and audit |
| Exceptional Access Authorization | Records a purpose-limited request, approval or emergency review, scope, and time limit for exceptional content access | Administration and audit |
| Audit Event | Immutable material security, administration, lifecycle, source-policy, or user-impacting event metadata without raw sensitive payloads | Observability and operations |
| Preservation Hold | A scoped, owned, reviewed exception that temporarily preserves data for a security incident or legal obligation | Governance and operations |

### Approved lifecycle clarifications

- An active account may authenticate and receive user-specific background work. A suspended or closed account may not.
- Closing an account starts the bounded deletion lifecycle; it is not a reversible account state.
- User-owned active-system data is deleted within 30 days of a valid closure or deletion request; protected recovery copies expire within 90 days of creation.
- A preservation hold limits deletion only for its approved data scope and does not grant additional access rights.
