# ADR-013: Immutable Versioned Evaluation Snapshots

- Status: Accepted
- Date: 2026-08-22

## Context

ADR-002 requires hybrid, explainable job matching. The MVP must show deterministic eligibility outcomes, evidence, uncertainty, and AI-assisted interpretation. ADR-005 already establishes immutable profile versions, and profile, job, and matching-policy changes can require re-evaluation. User reviews are separate from matching outcomes under the domain model.

## Decision

Persist immutable, versioned, user-specific evaluation snapshots. Each snapshot shall identify the approved profile version, relevant job or listing observation, and matching-policy version used to create it. It shall retain deterministic eligibility and hard-constraint outcomes, ranking dimensions, evidence, uncertainty, and AI-assisted interpretation sufficient to explain the result.

The dashboard receives a designated current evaluation or an equivalent derived read model. Re-evaluation creates a new snapshot instead of mutating a prior snapshot. User save and not-interested actions remain separate review state and do not alter evaluation evidence or scores.

This ADR does not choose a model, prompt, scoring algorithm, storage technology, or policy-versioning implementation.

## Alternatives Considered

### A. One mutable current evaluation per user and job

Easy to read, but it loses the basis for prior recommendations after a relevant change.

### B. Immutable versioned snapshots with a current evaluation

Selected. It preserves explainability, supports re-evaluation, and offers efficient current-result reads.

### C. Compute evaluations only when the dashboard is viewed

Avoids persistence but is slow, inconsistent, unauditable, and incompatible with reliable scheduled discovery.

### D. Persist final scores only

Compact, but insufficient for ADR-002's explainability and correction needs.

## Consequences

Evaluation history is available for user trust, diagnosis, and safe re-evaluation. The system must define how it derives the current evaluation when multiple snapshots exist, without rewriting historical results. Sensitive input and explanation data remain subject to access and observability controls.
