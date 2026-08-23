# ADR-007: Prefer an Official Application Link While Retaining Alternatives

## Status

Accepted — 2026-08-18

## Context

A canonical job can have multiple source listings and application URLs. Users need a clear direct route to apply, but source URLs vary in quality, freshness, and whether they lead to the employer's actual application system.

## Decision

For a canonical job, prefer the employer's official ATS or career-site application link when available. Otherwise select the best current authorized source link as primary. Retain other current source links in the job-detail view.

## Alternatives Considered

### A. First discovered link

Simple but arbitrary and potentially stale or indirect.

### B. Preferred primary link with alternatives

Guides the user to the best application route while preserving provenance and choice. This is the selected option.

### C. Present all links equally

Preserves choice but burdens users with an unnecessary decision.

## Why We Chose This

It improves user experience and application-link reliability without discarding source information.

## Consequences

### Positive

- Users get a clear recommended application route.
- Official links are favored when available.
- Alternatives remain inspectable.

### Negative

- Requires a transparent link-preference policy.
- The preferred link can become stale and must be re-evaluated.

## Revisit Conditions

Reconsider if source contracts impose link-selection restrictions or measured results show another route is consistently more reliable.
