# ADR-014: Dashboard Uses a User-Scoped Query and Command Boundary

- Status: Accepted
- Date: 2026-08-23

## Context

The MVP dashboard supports profile setup, discovery status, new-job review, job details and evidence, save/not-interested actions, and external application links. Canonical jobs and source listings are shared records while evaluations and reviews are user-specific (ADR-004). The private beta requires isolated individual accounts.

## Decision

The dashboard shall use a dedicated application-facing query and command boundary. Queries return the authenticated user's permitted read models, including job results combined with that user's current evaluation and review context, profile state, and truthful processing status. Commands are authenticated and routed to the owning capability for profile changes, guarded manual refresh, user review actions, and external-link use.

The dashboard shall not directly create or modify canonical jobs, source listings, discovery process records, or evaluation snapshots.

This ADR does not select an API style, framework, database, or independently deployed backend-for-frontend.

## Alternatives Considered

### A. Dashboard accesses underlying domain records directly

Fast to assemble, but couples the UI to internal processing structures and weakens isolation and evolution boundaries.

### B. Dedicated application-facing query and command boundary

Selected. It supports user-scoped presentation and protected commands while keeping domain and background-work concerns internal.

### C. Independently deployed backend-for-frontend

Offers additional separation, but introduces an unneeded deployable boundary for the MVP.

### D. Dashboard owns a copied subset of job data

May simplify rendering but creates synchronization and consistency risks for evaluations and reviews.

## Consequences

The system must enforce resource ownership at the boundary and within responsible capabilities. Read models may be optimized for dashboard needs, but must not weaken source restrictions or expose shared records outside the authenticated user's permitted context. The background pipeline remains the authority for collection, processing, and evaluation lifecycle.
