# ADR-039: Classify Material Job Changes Before Re-evaluation

## Status

Accepted — 2026-08-23

## Context

Immutable source-listing observations make changes visible over time. Re-evaluating every observation would waste work and create noisy dashboard changes, while waiting for the next scheduled discovery can leave important eligibility, availability, or application-link changes stale.

## Decision

- The system shall classify observed job changes by their potential effect on user-facing results.
- A change that could affect eligibility, matching, availability, or the preferred application link is material and triggers the applicable availability processing, current-view update, and re-evaluation.
- Changes not reasonably capable of affecting those outcomes may update retained evidence or current presentation without automatic re-evaluation.
- Re-evaluation creates a new immutable evaluation snapshot; it does not alter historical snapshots or a user's review decision.
- A material update may be surfaced as updated while preserving saved and not-interested user-review state.

This ADR does not define comparison algorithms, queues, scheduling mechanisms, or implementation technology.

## Alternatives Considered

### A. Re-evaluate every observation

This maximizes freshness but creates unnecessary work and user-visible churn from insignificant changes.

### B. Classify changes and re-evaluate only material changes

Re-evaluate changes that could affect eligibility, matching, availability, or the primary application link. This is the selected option.

### C. Wait until the next scheduled discovery

This reduces immediate work but can leave important changes stale for too long.

## Why We Chose This

The selected policy focuses computation and dashboard updates on changes that can matter to a user's decision, while retaining all source evidence for explanation and later review.

## Consequences

### Positive

- Important changes are reflected promptly in current results.
- Insignificant source edits do not create needless evaluation versions.
- User review state remains stable across system updates.

### Negative

- The architecture needs explicit materiality rules.
- Some borderline changes may require later refinement of the classification policy.

## Revisit Conditions

Reconsider if observed source changes show that the materiality categories are too broad or too narrow, or if the product adds user-configurable update preferences.
