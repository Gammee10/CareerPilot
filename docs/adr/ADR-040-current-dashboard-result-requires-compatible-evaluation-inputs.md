# ADR-040: Select Current Dashboard Results from Compatible Evaluation Inputs

## Status

Accepted — 2026-08-23

## Context

User-job evaluations are immutable snapshots. A newer snapshot can still be unsuitable for the dashboard if it was produced from a superseded profile version or materially superseded job evidence. The dashboard needs a truthful current-result rule without discarding prior explanation.

## Decision

- The dashboard's current result for a user and job shall be the newest successful evaluation compatible with the user's current approved profile and the current material job evidence.
- Earlier evaluation snapshots remain retained and attributable to their original profile and job inputs.
- An evaluation based on an outdated profile or materially superseded job evidence shall not be presented as current.
- If no compatible successful evaluation exists, the dashboard shall not imply that a current personalized result exists; applicable workflow processing may create one under its established policy.

This ADR does not select query mechanisms, data-store views, caching, or implementation technology.

## Alternatives Considered

### A. Always show the newest evaluation

This is simple but can present a result based on obsolete user preferences or job evidence as current.

### B. Show the newest compatible successful evaluation

Require compatibility with the current approved profile and current material job evidence, while retaining earlier snapshots. This is the selected option.

### C. Show results only after an explicit user refresh

This gives user control but undermines scheduled discovery and leaves the dashboard stale unnecessarily.

## Why We Chose This

The selected rule makes the dashboard's current label meaningful. It connects immutable snapshots to the current user and job views without rewriting history.

## Consequences

### Positive

- The dashboard avoids representing obsolete evidence as current.
- Historical results remain available for traceability.
- Current-result behavior is consistent across scheduled and manually initiated processing.

### Negative

- A job may temporarily have no current personalized result.
- Compatibility must be defined from existing profile and material-job evidence rules.

## Revisit Conditions

Reconsider if the product adds comparison of historical evaluations, user-selected profile versions, or a distinct stale-result presentation.
