# ADR-004: Separate Canonical Jobs, Source Listings, and User-Specific State

## Status

Accepted — 2026-08-18

## Context

The same opportunity can be discovered through multiple authorized sources and can be evaluated independently for multiple users. Source provenance and application URLs must be retained, while scores and review decisions are private to each user.

## Decision

Model job information in three layers:

- A canonical job represents the normalized opportunity.
- A source listing represents a source-specific observation of that opportunity, including provenance and source-specific data or URL.
- User-specific evaluation and review state represent a particular user's match, explanation, and decision about the canonical job.

## Alternatives Considered

### A. Per-user job copies

Simple at first but duplicates source data and makes deduplication, availability updates, and future scaling difficult.

### B. Canonical job only

Efficient but cannot preserve multiple source representations or user-specific state cleanly.

### C. Canonical job, source listings, and user-specific state

Separates shared data, provenance, and personal data. This is the selected option.

## Why We Chose This

It supports source-agnostic normalization and deduplication while preserving traceability and user isolation.

## Consequences

### Positive

- Cross-source deduplication is possible.
- Provenance and alternate application links are preserved.
- User reviews and evaluations remain private and independently recomputable.

### Negative

- More entities and relationships than a per-user copy model.
- Canonicalization needs explicit confidence and conflict-handling rules.

### Risks

- Incorrectly merging distinct opportunities can hide relevant jobs.
- Failing to merge duplicates can create dashboard fatigue.

## Revisit Conditions

Reconsider only if source licensing prevents shared storage or if product scope is deliberately constrained to isolated, user-submitted jobs.
