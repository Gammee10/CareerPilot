# ADR-010: Durable Stateful Background-Work Coordination

- Status: Accepted
- Date: 2026-08-22

## Context

The MVP runs per-user scheduled discovery, permits guarded manual refresh, extracts uploaded resumes, collects from multiple sources, and re-evaluates active jobs after relevant profile or search updates. These operations can take time, fail partially, and be retried. The domain model already defines `Discovery Run` and `Source Collection Attempt` as process records, and the product requires accurate status and no duplicate user-visible results.

## Decision

Use durable, stateful workflow coordination across the background-work boundary. Discovery orchestration owns the authoritative `Discovery Run` lifecycle and submits independently executable work. Background-work processing executes individual logical work units, including resume extraction, source collection, normalization, deduplication, availability updates, job analysis and matching, and re-evaluation.

The workflow must explicitly support idempotency, retry handling, partial failure, concurrency control, and process-status visibility. A source failure is recorded but does not invalidate useful results from other sources. Retries and overlapping triggers must not create duplicate user-visible jobs or evaluations.

This ADR intentionally does not select a queue, workflow engine, scheduler, or deployment technology.

## Alternatives Considered

### A. Direct synchronous invocation

Simple for a small path, but unsuitable for slow source collection, extraction, retries, or reliable partial-failure recording.

### B. Ad hoc background tasks

Moves work away from the interactive path, but leaves lifecycle, idempotency, retries, and status semantics inconsistent across capabilities.

### C. Durable stateful workflow coordination

Selected. It makes runs and stage outcomes authoritative, supports independently retryable work, and preserves partial results and operational visibility.

### D. Separate workflow service for every pipeline stage

Provides isolation but introduces premature distributed-service coordination for the MVP, contrary to ADR-008.

## Consequences

The system needs explicit state transitions and deduplication/idempotency keys at appropriate work boundaries. The dashboard can show reliable run and source-attempt status from persisted process records. Component boundaries remain modular within the two runtime roles established by ADR-008.
