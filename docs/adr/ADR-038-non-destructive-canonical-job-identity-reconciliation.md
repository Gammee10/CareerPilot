# ADR-038: Reconcile Canonical-Job Identity Non-Destructively

## Status

Accepted — 2026-08-23

## Context

Conservative canonicalization can be revised as new source-listing observations arrive. A candidate match can later prove to be separate opportunities, and separate candidates can later prove to be one opportunity. Irreversibly overwriting canonical-job identity would break provenance and make existing evaluations and user review history difficult to explain.

## Decision

- Canonical-job identity reconciliation is non-destructive and evidence-backed.
- A merge or split records the affected identities, supporting evidence, decision time, and resulting current relationship; it does not erase the prior identities or source-listing observations.
- Historical evaluations and user reviews remain linked to the canonical-job identity and input evidence used when they were created.
- The current dashboard view resolves reconciled identities consistently, without silently discarding a user's review history.
- Uncertain cases remain separate until sufficient evidence supports reconciliation.

This ADR does not select identifiers, data-store relations, reconciliation algorithms, or implementation technology.

## Alternatives Considered

### A. Permanently merge identities once matched

Replace one identity with another and discard the old relationship. This keeps the model simple but makes incorrect deduplication difficult to repair.

### B. Non-destructive, evidence-backed identity reconciliation

Retain identities and observations while recording merge or split relationships and deriving the current view. This is the selected option.

### C. Do not maintain canonical-job identity

Use only source-listing observations. This avoids reconciliation but defeats cross-source grouping and complicates personalized evaluation and review.

## Why We Chose This

The selected approach preserves the conservative-deduplication posture while allowing corrections. It maintains an explainable path from source evidence through canonicalization to each user-specific result.

## Consequences

### Positive

- Incorrect matches can be repaired without destructive data changes.
- User review and evaluation history remains explainable.
- Dashboard results can reflect the current reconciliation decision.

### Negative

- Reconciliation introduces explicit historical relationships and current-view rules.
- A material correction may require re-evaluation or an updated dashboard presentation.

## Revisit Conditions

Reconsider if source data cannot support evidence-backed reconciliation, or if a future product requirement needs users to manage duplicate grouping directly.
