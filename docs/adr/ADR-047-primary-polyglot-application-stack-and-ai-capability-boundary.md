# ADR-047: Use a Polyglot Application Stack with a Narrow Internal AI Capability

## Status

Accepted — 2026-08-23

## Context

The MVP requires a rich authenticated dashboard, an authoritative application boundary, durable background processing, and AI-assisted resume and job interpretation. The project expects to evolve beyond the MVP, but ADR-008 intentionally avoids independently owned domain microservices. The chosen stack must allow TypeScript-based product development while using Python where it is valuable for AI-related work, without making the AI boundary an uncontrolled second backend.

## Decision

- Use Next.js with TypeScript for the frontend.
- Use Node.js with TypeScript and Express for the authoritative application backend.
- Use FastAPI with Python as a narrowly scoped, internal, non-public AI-processing capability.
- The Express backend owns the application-facing query and command boundary, authentication integration, discovery orchestration, source adapters, normalization, canonicalization, user-specific state, and persistence coordination.
- Next.js owns dashboard presentation and interaction. It does not execute durable collection, evaluation, or other long-running background work.
- FastAPI may perform approved resume extraction and job interpretation or matching using purpose-scoped inputs and return structured proposed interpretations to the Node-owned background-work path.
- FastAPI shall not directly authenticate users, own workflow state, write authoritative records, bypass Node-side validation or deterministic policy, or receive data outside its approved task scope.
- The accepted interactive/control-plane and background-work logical roles remain. FastAPI is an internal capability used by background work, not a separately owned domain service or public application backend.
- Durable workflow coordination shall not rely on request-tied FastAPI background tasks; its technology remains a separate decision.

This ADR does not select a database, object storage, queue or workflow mechanism, identity or email provider, hosting, external AI provider, model, observability product, or deployment product.

## Alternatives Considered

### A. One TypeScript stack for frontend, backend, and AI processing

This minimizes language and runtime diversity but limits the team's ability to use Python-oriented AI tooling where it is valuable.

### B. Polyglot stack with a narrow internal FastAPI AI capability

Use Next.js/TypeScript for the frontend, Express/TypeScript for authoritative application behavior, and FastAPI/Python only for purpose-scoped AI processing. This is the selected option.

### C. Separate public FastAPI AI backend or domain microservices

This can independently scale or specialize AI work, but prematurely adds public interfaces, distributed domain ownership, and operational coordination.

## Why We Chose This

The selected arrangement preserves a coherent TypeScript product core while allowing Python where it directly serves AI interpretation. Keeping FastAPI internal and non-authoritative preserves the approved security, data-governance, workflow, and domain-ownership boundaries.

## Consequences

### Positive

- The dashboard and product backend share TypeScript expertise and contracts.
- Python is available for focused AI-processing tasks.
- Authoritative policy, user isolation, and persistence remain in one application backend.
- The MVP avoids early public microservice boundaries.

### Negative

- The project carries two application languages and runtime environments.
- The Node-to-FastAPI capability contract requires versioning, validation, and operational visibility.

### Risks

- Allowing FastAPI to expand beyond its narrow scope could recreate a competing backend.
- Inconsistent validation or data-access enforcement across runtimes could weaken the approved security boundaries.

## Revisit Conditions

Reconsider if measured AI workload requires independent scaling or ownership, the team no longer benefits from Python tooling, or product requirements justify an explicitly approved service-boundary change.
