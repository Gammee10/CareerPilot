# ADR-020: Use a Bounded Lifecycle for User-Owned Sensitive Content

## Status

Accepted — 2026-08-23

## Context

ADR-019 establishes category-based, lifecycle-bound retention. User-owned sensitive content includes raw resume artifacts, resume-extraction drafts, approved profile versions, user-specific evaluation snapshots, and job-review state. The MVP needs current content and historical profile/evaluation records for user-approved profile behavior, explainability, and re-evaluation. It does not need to retain redundant raw resume files indefinitely.

## Decision

- Retain a user's current raw resume and approved profile versions, evaluation snapshots, and review state while the account is active, as required for approved product behavior.
- Delete a replaced or user-removed raw resume, and an abandoned resume-extraction draft, after a 30-day grace period.
- On account closure or a valid deletion request, immediately disable access and delete user-owned data from active systems within 30 days.
- Recovery-copy expiry is governed by ADR-024's maximum 90-day lifecycle.
- Any legal or security-preservation hold must be explicit, purpose-limited, and separately governed; it is not a default exception to deletion.

This ADR does not define retention of shared source data, authentication records, audit records, or operational telemetry.

## Alternatives Considered

### A. Retain every uploaded resume and derived record for the active-account lifetime

This preserves complete artifact history but over-retains highly sensitive raw resumes.

### B. Retain active-account records while bounding redundant raw artifact retention

Keep the current resume and necessary immutable history while deleting replaced, removed, and abandoned raw artifacts after a short grace period. This is the selected option.

### C. Delete raw resumes immediately after extraction and approval

This minimizes raw-file retention but prevents re-extraction, review of the original artifact, and reliable investigation of extraction disputes.

## Why We Chose This

The selected lifecycle keeps the evidence and history required by the accepted MVP behavior while reducing the accumulation of redundant raw resume files. It provides a clear account-deletion outcome without conflating active-system deletion and recovery-copy lifecycle.

## Consequences

### Positive

- Current profile and matching behavior retain their necessary inputs and history.
- Superseded and abandoned raw resumes do not accumulate indefinitely.
- Account closure and deletion requests have a defined active-system completion target.

### Negative

- Users and operations must understand the 30-day grace period for removed artifacts.
- Recovery-copy expiry and deletion handling are governed by ADR-024.

### Risks

- A 30-day grace period may be longer than some users expect for removal, or shorter than an operational recovery need.
- A poorly governed preservation hold could weaken the deletion guarantee.
- Retained profile and evaluation history remains sensitive and requires the access controls of ADR-016 and ADR-017.

## Revisit Conditions

Reconsider if product behavior requires longer artifact history, users need different deletion expectations, applicable obligations change, or operational evidence shows the grace period is unsuitable.
