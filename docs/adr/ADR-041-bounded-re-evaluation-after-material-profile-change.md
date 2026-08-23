# ADR-041: Bound Re-evaluation After a Material Profile Change

## Status

Accepted — 2026-08-23

## Context

A newly saved approved profile version can materially change eligibility and matching results for jobs already known to the system. Re-evaluating all retained history is unnecessary and can conflict with the current-result policy, while waiting solely for the next normal discovery cycle leaves the dashboard stale after an important user action.

## Decision

- A material approved profile change triggers re-evaluation of the bounded set of currently available, relevant jobs in that user's active discovery scope.
- Historical, unavailable, or out-of-scope jobs are not automatically re-evaluated solely because of that profile change.
- Each resulting evaluation is a new immutable snapshot using the new profile version and applicable current job evidence.
- The dashboard uses ADR-040's compatible-current-result rule during this processing.

This ADR does not define the exact relevance calculation, scheduling mechanism, work queue, or implementation technology.

## Alternatives Considered

### A. Re-evaluate every retained job ever evaluated for the user

This maximizes historical coverage but spends work on unavailable and irrelevant history with little current product value.

### B. Re-evaluate currently available, relevant jobs in the active discovery scope

Bound work to jobs that can contribute to current dashboard results. This is the selected option.

### C. Wait for the next ordinary discovery cycle

This reduces immediate work but leaves current results stale after a material user-approved profile update.

## Why We Chose This

The selected policy responds to the user's meaningful change while aligning re-evaluation with the MVP's current discovery scope and availability model.

## Consequences

### Positive

- Current dashboard results adapt promptly to meaningful profile updates.
- Work remains bounded and focused on actionable opportunities.
- Historical snapshots remain intact without needless regeneration.

### Negative

- Older or out-of-scope jobs do not receive new results automatically.
- The system needs a clear definition of material profile change and active scope.

## Revisit Conditions

Reconsider if users need retrospective comparison across all past jobs, or if the product adds long-lived job archives as a first-class experience.
