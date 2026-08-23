# ADR-012: Explicit Normalization, Canonicalization, and Availability Stages

- Status: Accepted
- Date: 2026-08-22

## Context

Source adapters emit provenance-preserving observations under ADR-011. ADR-004 separates canonical jobs from source listings, ADR-006 requires layered conservative deduplication, and the domain model requires availability history. Collection results can be incomplete or transient, so source absence alone is not proof that a job is permanently unavailable.

## Decision

Use three explicit logical stages in the shared job-processing pipeline:

1. Normalization validates and translates source observations into the common job and source-listing representation.
2. Canonicalization performs conservative layered duplicate resolution, linking a listing to a canonical job or creating one when appropriate.
3. Availability processing records listing-level observations and maintains derived canonical-job availability.

The stages remain component boundaries within the modular system rather than independently deployed services. They persist outcomes appropriate for downstream processing, review, and safe retries.

## Alternatives Considered

### A. One consolidated post-collection processor

Fewer visible boundaries, but it obscures whether a defect arises in source translation, duplicate resolution, or availability handling.

### B. Three explicit logical stages

Selected. It makes responsibilities, operational outcomes, and conservative availability semantics clear while remaining consistent with ADR-008.

### C. Canonicalization before normalization

Preserves raw source form initially, but prevents consistent cross-source matching and duplicates source-specific interpretation.

### D. Availability managed solely in each adapter

Localizes polling behavior but cannot provide coherent listing and canonical-job availability history.

## Consequences

Pipeline outcomes can be retried and investigated independently. Availability processing must be cautious: a missing listing in one run is an observation, not an automatic permanent removal. Provenance remains available for evidence, source compliance, and application-link selection.
