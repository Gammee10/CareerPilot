# ADR-008: Use a Modular System with Separate Interactive and Background Runtime Roles

## Status

Accepted — 2026-08-21

## Context

The MVP needs authenticated dashboard interactions as well as daily per-user discovery, manual refreshes, resume extraction, source collection, normalization, conservative deduplication, AI-assisted analysis, evaluation, and re-evaluation. Much of this work must continue after a user leaves the dashboard and must not make interactive use unreliable.

The private beta must avoid irreversible single-user assumptions, while remaining small enough that a distributed set of business services would impose disproportionate operational and consistency complexity.

## Decision

Use one modular system with explicit logical capability boundaries and two independently operable runtime roles:

- an interactive/control-plane role for authenticated user and administrator interactions; and
- a background-work role for durable asynchronous processing.

This decision does not select a framework, database, queue, cloud provider, or deployment product. It also does not establish independently deployable domain services. Capability ownership and defined work/record boundaries shall be preserved within the modular system.

## Alternatives Considered

### A. One deployable runtime for all work

This minimizes initial operational setup, but lets collection, resume processing, and AI work compete with interactive requests and makes background reliability less explicit.

### B. Modular system with separate interactive and background runtime roles

This retains a cohesive MVP while allowing durable asynchronous work to operate independently of the dashboard. This is the selected option.

### C. Independently deployable domain services

This offers strong isolation and independent scaling, but introduces premature distributed-system concerns, operational burden, and cross-service consistency risk for the private beta.

## Why We Chose This

The chosen boundary offers the best balance of interactive reliability, durable background processing, maintainability, and MVP operational simplicity. It supports the accepted source, profile-versioning, canonical-job, and explainable-matching decisions without prematurely committing to microservices.

## Consequences

### Positive

- Interactive dashboard work is isolated from resource-intensive or slow background processing.
- Scheduled and user-requested discovery can continue independently of a browser session.
- Logical capability boundaries make future extraction possible if justified by evidence.
- The architecture remains technology-neutral at this stage.

### Negative

- The system must define durable work handoffs, idempotency, retry behavior, concurrency safeguards, and operational visibility.
- Shared records require disciplined ownership and explicit contracts even within one codebase.

### Risks

- Weak module boundaries could create an accidental monolith that is difficult to evolve.
- Treating background work as merely an implementation detail could undermine required reliability and transparency.
- Prematurely extracting modules despite this decision would add unnecessary distributed-system complexity.

## Revisit Conditions

Reconsider if measured usage, performance, reliability, security, team ownership, or source-compliance requirements show that separately operable runtime roles and modular boundaries are insufficient.
