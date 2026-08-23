# ADR-044: Use Bounded, Source-Policy-Aware Collection Retry and Recovery

## Status

Accepted — 2026-08-23

## Context

An authorized source collection attempt can fail transiently or be rate-limited. Waiting for the next discovery run can leave recoverable gaps in useful results, while unbounded or indiscriminate retries can violate source controls, delay run completion, and create duplicate downstream processing. ADR-043 permits partial discovery results and requires truthful source-attempt status, but does not define retry and recovery policy.

## Decision

- Source collection shall use bounded, source-policy-aware retry within the current discovery run.
- Only clearly transient failures may be retried automatically, within the source's configured attempt and time budget.
- Source-provided retry timing and rate limits must be honored.
- Authorization, source-policy, invalid-request, and other non-transient failures shall not be retried automatically.
- If recovery cannot complete within the run's bounds, record the applicable failed, rate-limited, or deferred outcome and allow the discovery run to complete partially under ADR-043.
- A later scheduled or permitted manual discovery run may try the source again under its source policy.
- Retries must preserve idempotent processing and must not create duplicate source observations or user-visible evaluations.

This ADR does not select retry counts, backoff calculations, queues, schedulers, monitoring products, or implementation technology.

## Alternatives Considered

### A. No automatic retry; wait for the next discovery run

This minimizes source pressure and operational complexity, but leaves transiently recoverable coverage gaps until a later run.

### B. Bounded, source-policy-aware retry within the current run

Retry eligible transient failures only within a bounded current-run budget, honor source controls, and record an unrecovered attempt truthfully for later runs. This is the selected option.

### C. Persistent recovery retries independent of discovery runs

Continue retries in a separate recovery process until success or expiry. This can improve freshness but complicates concurrency, run attribution, and source-pressure control.

## Why We Chose This

The selected policy recovers ordinary transient failures when it is safe to do so, without treating source limits as obstacles to bypass. It preserves ADR-043's truthful partial-completion behavior and ADR-010's idempotency and status requirements.

## Consequences

### Positive

- Recoverable source failures can yield results in the current run.
- Source-specific rate limits and retry guidance remain authoritative.
- Users receive useful partial results rather than indefinite waiting.
- Unrecovered failures remain attributable and eligible for later permitted collection.

### Negative

- Each source policy requires explicit transient/non-transient failure classification and retry bounds.
- A source can remain unavailable after its current-run retry budget is exhausted.

### Risks

- Incorrect failure classification could either retry an inappropriate request or abandon a recoverable one.
- Retry handling that is not idempotent could duplicate observations or evaluations.

## Revisit Conditions

Reconsider if source contracts require a different recovery model, measured source behavior shows the configured bounds are consistently too short or too long, or a future product requirement needs independently scheduled source recovery.
