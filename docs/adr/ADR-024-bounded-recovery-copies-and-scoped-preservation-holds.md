# ADR-024: Use Bounded Recovery Copies and Scoped Preservation Holds

## Status

Accepted — 2026-08-23

## Context

ADRs 019 through 021 define bounded active-system retention and deletion schedules, but deletion guarantees are incomplete without recovery-copy treatment. ADR-023 requires minimum necessary evidence preservation during an incident. The system needs recoverability and legitimate investigation capacity without allowing either recovery copies or preservation holds to become indefinite-retention mechanisms.

## Decision

- Recovery copies expire no later than 90 days after creation.
- After deletion from active systems, user data is inaccessible and may remain only in protected recovery copies until their normal expiry.
- If recovery restores a copy containing data subject to a valid deletion request, the deletion is re-applied.
- A preservation hold may be created only for a defined security incident or specific legal obligation.
- Each hold has a named owner, restricted data scope, documented justification, expiry or review date, and audit record.
- A hold does not grant additional access rights, cannot be blanket or indefinite, and cannot be used for ordinary operational convenience.

This ADR does not select backup technology, recovery procedures, legal advice, or implementation tooling.

## Alternatives Considered

### A. Indefinite recovery copies and informal holds

Keep recovery copies indefinitely and retain data when it appears useful. This is operationally convenient but undermines approved deletion guarantees and data minimization.

### B. Bounded recovery copies and scoped, approved preservation holds

Expire recovery copies within a fixed bound and permit only documented, time-limited holds for active security incidents or specific legal obligations. This is the selected option.

### C. No recovery copies or preservation holds

This maximizes deletion certainty but creates unacceptable recovery and incident-investigation risk.

## Why We Chose This

The selected policy treats recovery and preservation as justified, bounded exceptions rather than permanent copies of deleted data. It preserves the ability to recover from failure and investigate incidents without silently weakening the retention model.

## Consequences

### Positive

- User deletion has a defined maximum recovery-copy tail.
- Incident evidence can be preserved without granting broader content access.
- Restored data does not silently defeat valid deletion requests.

### Negative

- Recovery procedures must re-apply completed deletion requests.
- Hold records require ownership and scheduled review.

### Risks

- A 90-day recovery window may be inadequate for some future operational needs.
- Poor hold scope or review discipline could unnecessarily extend retention.
- Restoring data without a reliable deletion replay process could violate the policy.

## Revisit Conditions

Reconsider if recovery objectives, legal obligations, security incidents, or product scale demonstrate that the maximum recovery-copy period or hold process is inadequate.
