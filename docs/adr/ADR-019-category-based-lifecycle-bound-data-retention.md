# ADR-019: Use Category-Based, Lifecycle-Bound Data Retention

## Status

Accepted — 2026-08-23

## Context

The MVP retains sensitive user data, immutable profile and evaluation history, shared job and source records, authentication records, audit events, and operational telemetry. ADR-005 and ADR-013 require historical records for explainability and re-evaluation. ADR-011 requires enforcement of source-specific use restrictions, and ADR-015 requires sensitive-data minimization. A single retention rule cannot meet all of these obligations.

## Decision

Use category-based, lifecycle-bound retention.

- Retain data only while necessary for an active account, approved product behavior, security and operational obligations, or applicable source-use restrictions.
- Immutable profile and evaluation history may be retained while it supports approved explainability and re-evaluation behavior; immutability does not authorize indefinite retention.
- User-owned data, shared job and source data, authentication records, audit records, operational telemetry, and exceptional-access records each require an explicit retention and deletion lifecycle.
- Source-specific retention, display, sharing, and deletion restrictions take precedence when more restrictive.
- Account closure and user-requested deletion require a defined, bounded deletion lifecycle, subject only to separately defined legal or incident-preservation requirements.

Subsequent ADRs define retention periods, deletion timing, recovery-copy treatment, preservation holds, and raw-resume lifecycle.

## Alternatives Considered

### A. Retain all data until manually deleted

This is simple to implement but conflicts with data minimization and may violate source-use restrictions.

### B. Category-based, lifecycle-bound retention

Apply data-category-specific, bounded lifecycles and honor stricter source restrictions. This is the selected option.

### C. Retain only current profile and evaluation state

This strongly minimizes retained data but undermines the approved historical explainability, evaluation traceability, and re-evaluation model.

## Why We Chose This

The selected approach preserves necessary MVP behavior without normalizing indefinite retention. It allows source obligations and the sensitivity of each data category to govern the lifecycle rather than forcing an unsuitable one-size-fits-all rule.

## Consequences

### Positive

- Retention is aligned with purpose and sensitivity.
- Immutable records remain available only for justified product behavior.
- Source-specific restrictions can be honored without redesigning all data handling.

### Negative

- The system needs explicit lifecycle rules for several record classes.
- Deletion and preservation processes must distinguish data categories and source restrictions.

### Risks

- Missing or inconsistent lifecycle rules could lead to over-retention or premature deletion.
- Source restrictions may materially limit shared-job historical analysis.
- Legal or incident holds could become an unbounded exception if not separately governed.

## Revisit Conditions

Reconsider if source contracts, legal obligations, product capabilities, or measured operational needs materially change the justified retention purposes.
