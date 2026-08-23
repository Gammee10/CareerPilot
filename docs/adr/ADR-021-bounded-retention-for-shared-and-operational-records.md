# ADR-021: Use Bounded Retention for Shared and Operational Records

## Status

Accepted — 2026-08-23

## Context

ADR-019 requires category-based, lifecycle-bound retention, and ADR-020 defines user-owned sensitive-content retention. Shared source and job records, authentication metadata, audit events, exceptional-access records, operational telemetry, and temporary incident diagnostics require their own schedules. Source contracts may impose more restrictive limits, while security and operational investigation require records to persist longer than short-lived telemetry.

## Decision

- Retain shared source listings, canonical-job details, and availability history until the sooner of the source's permitted maximum retention period or 180 days after last observation.
- Retain authentication lifecycle metadata and routine audit events for 12 months.
- Retain exceptional-access requests, approvals, access events, and retrospective reviews for 24 months.
- Retain operational telemetry and traces for 90 days.
- Retain raw incident diagnostic material only for the defined scope and duration of that incident, then delete it when no longer needed.
- Continue to apply ADR-015 sensitive-data minimization to all retained records.

Recovery-copy expiry and the preservation-hold process are defined by ADR-024.

## Alternatives Considered

### A. Indefinite operational retention

Keep source, audit, and operational records indefinitely for convenience. This conflicts with minimization and creates unnecessary source, privacy, and compliance exposure.

### B. Bounded default schedules with stricter source terms taking precedence

Retain each class only for a justified period and honor stricter source restrictions. This is the selected option.

### C. Thirty-day retention for all operational records

This minimizes retained data but leaves inadequate history for reliability investigation, account-access analysis, and delayed incident discovery.

## Why We Chose This

The selected schedules preserve enough evidence for meaningful operations and security review without treating data as permanently useful. They also recognize that authorized source contracts may legitimately impose shorter limits.

## Consequences

### Positive

- Retention purposes and durations are explicit for the main shared and operational categories.
- Source restrictions are enforced as an upper bound rather than overridden by product convenience.
- Security-sensitive exceptional-access activity remains reviewable longer than routine telemetry.

### Negative

- Lifecycle enforcement must distinguish multiple data categories.
- Some historical job context will expire even if it could be operationally useful later.

### Risks

- A source contract may require a shorter or materially different lifecycle than the default.
- Incident discovery after retention expiry may have less available evidence.
- Raw diagnostic material could be over-retained if incident scope is poorly controlled.

## Revisit Conditions

Reconsider if source contracts, incident experience, legal obligations, or operational evidence demonstrate that a duration is inadequate or excessive.
