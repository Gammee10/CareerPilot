# ADR-037: Preserve Immutable Source-Listing Observations and Derive Current Views

## Status

Accepted — 2026-08-23

## Context

Job listings can change after collection: descriptions, requirements, application links, and availability may be revised or withdrawn. The system needs to preserve source provenance and explain a user evaluation using the exact job evidence available when it was produced, while still presenting a useful current job view.

## Decision

- Each source-adapter collection result is an immutable, provenance-preserving source-listing observation.
- A current source-listing view and current canonical-job view are derived from the latest relevant observations; they are not a destructive replacement of prior evidence.
- A user evaluation references the specific source-listing observation or canonical-job version used as its input.
- Material changes may trigger availability processing and re-evaluation under the existing workflow policy.
- Observation retention remains subject to source restrictions and ADR-021's shared-data limit.

This ADR does not select storage, event, versioning, or workflow technology.

## Alternatives Considered

### A. Mutate the current source listing in place

Keep one mutable record and selected history fields. This is simpler to query but weakens provenance and makes past evaluations harder to explain.

### B. Immutable observations with derived current views

Preserve every collected observation and derive current source-listing and canonical-job views. This is the selected option.

### C. Version only the canonical job

Keep source listings mutable and version the canonical job. This preserves less source-specific evidence and obscures the origin of changes.

## Why We Chose This

Immutable observations keep the evidence behind matching, availability, and application-link decisions inspectable without making the dashboard operate on historical records. The approach extends the accepted provenance and immutable-evaluation boundaries.

## Consequences

### Positive

- Evaluations can identify the job evidence used at the time.
- Source-specific changes and corrections remain attributable.
- Current views remain straightforward for the dashboard.

### Negative

- Retained observations increase shared-data volume.
- Current-view derivation and material-change detection require explicit rules.

## Revisit Conditions

Reconsider if source terms prohibit retaining observations, retention limits make the model impractical, or product scope requires a different historical-job experience.
