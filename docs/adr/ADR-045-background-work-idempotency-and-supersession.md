# ADR-045: Use Idempotent, Supersession-Aware Background Work

## Status

Accepted — 2026-08-23

## Context

Durable background work may be delivered more than once, while newer approved profile versions or material job evidence can arrive before pending work begins or while it is running. The MVP must avoid duplicate source observations and user-visible evaluations without rewriting valid immutable history. Account suspension and closure must also prevent further user-specific processing.

## Decision

- Each background-work unit shall identify its immutable input and logical idempotency identity.
- Re-delivery of the same logical work shall produce at most one persisted outcome for those inputs.
- Distinct valid re-evaluations remain separate immutable outcomes.
- Before pending work begins, it shall verify that the associated account is active and that its input remains relevant.
- Pending work superseded by newer approved profile or material job evidence may be skipped when it cannot produce a current result.
- Newer profile or job evidence does not require cancellation of already-running work. Work that validly completes may persist its historical immutable outcome; ADR-040 prevents an incompatible evaluation from being presented as current.
- Suspension or closure stops pending user-specific work and prevents creation of new user-specific results.
- ADR-042 remains the mechanism for coalescing subsequent discovery using the latest approved profile and active scope.

This ADR does not select idempotency-key formats, locking, cancellation mechanisms, queues, schedulers, or implementation technology.

## Alternatives Considered

### A. Allow every delivery to complete

Persist every duplicate or stale delivery and rely on dashboard selection later. This is simple but wastes work and risks duplicate records.

### B. Idempotent logical outcomes with bounded supersession checks

Persist at most one outcome for the same logical inputs, skip pending work that cannot be current, and retain valid in-flight historical outcomes. This is the selected option.

### C. Cancel and restart all affected work immediately

This maximizes freshness but adds cancellation, partial-result, and coordination complexity beyond the MVP's needs.

## Why We Chose This

The selected policy protects correctness under at-least-once delivery while preserving the approved immutable-observation and immutable-evaluation model. It reduces avoidable work without requiring aggressive cancellation or changing ADR-040's current-result rule.

## Consequences

### Positive

- Retries and repeated delivery do not duplicate persisted logical outcomes.
- Pending work that cannot help the current experience can be avoided.
- Valid historical evidence remains attributable.
- Suspension and closure consistently halt user-specific processing.

### Negative

- Work records require explicit input identity and relevance checks.
- Some completed work will intentionally be historical rather than current.

### Risks

- An overly broad relevance check could skip work that should have remained current.
- Incorrect idempotency boundaries could suppress a legitimate distinct re-evaluation.

## Revisit Conditions

Reconsider if future processing requires stronger cancellation guarantees, independently scheduled recovery work, or a different consistency model for current results.
