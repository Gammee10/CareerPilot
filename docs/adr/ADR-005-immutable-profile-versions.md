# ADR-005: Preserve Immutable Career Profile Versions

## Status

Accepted — 2026-08-18

## Context

Users can change their profile, constraints, priorities, and search terms. The system asynchronously re-evaluates active jobs after such changes. Recommendations must remain explainable: a user needs to be able to determine which profile information produced a score.

## Decision

Every saved profile change creates an immutable profile version. The editable career profile identifies the current version. Each user job evaluation records the profile version and job observation or version used as input.

## Alternatives Considered

### A. Mutable profile only

Simple but cannot reliably explain historical evaluations after a profile update.

### B. Current profile plus independent evaluation snapshots

Preserves some history but risks inconsistent or incomplete representations of a profile.

### C. Immutable profile versions

Creates a coherent auditable history and is the selected option.

## Why We Chose This

It supports trustworthy explanations, safe asynchronous re-evaluation, and future decision auditing with bounded complexity.

## Consequences

### Positive

- Historic scores remain reproducible in context.
- Score changes can be attributed to profile or job changes.
- User-approved data remains distinct from extraction drafts.

### Negative

- Requires version lifecycle and storage management.
- Evaluation queries must select the appropriate current version.

### Risks

- Retaining historical profile versions retains sensitive career data longer.
- Unbounded history requires a future retention policy.

## Revisit Conditions

Reconsider if a privacy requirement demands destructive updates or if a simpler audit mechanism demonstrably satisfies explanation requirements.
