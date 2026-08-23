# ADR-049: Use PostgreSQL-Backed pg-boss for Durable Background Work

## Status

Accepted — 2026-08-23

## Context

ADRs 010, 042, 044, and 045 require durable asynchronous work with explicit retry, idempotency, coalescing, supersession, and user-visible status behavior. PostgreSQL is the selected MVP system of record. The MVP needs a Node-compatible durable-work mechanism without prematurely adding a separate workflow platform or Redis dependency.

## Decision

- The Node-owned background-work role shall use `pg-boss` backed by PostgreSQL for durable job execution.
- It shall execute independently from interactive requests and coordinate discovery, source collection, processing, re-evaluation, retry, and recovery behavior.
- Authoritative `Discovery Run`, source-attempt, and other domain process records remain explicit PostgreSQL records; queue delivery does not replace their status semantics.
- Node owns work orchestration, idempotency, supersession checks, and authoritative persistence.
- Node may invoke FastAPI for purpose-scoped AI processing, but FastAPI does not own or schedule durable jobs.
- Queue configuration and code must implement the approved source-policy-aware retry, coalescing, partial-result, suspension/closure, and idempotency rules; those policies are not delegated to library defaults.

This ADR does not select a PostgreSQL provider, worker-hosting model, queue configuration values, monitoring product, or implementation code.

## Alternatives Considered

### A. PostgreSQL-backed pg-boss

Use the selected PostgreSQL system to persist and coordinate Node jobs. This is the selected option.

### B. Temporal

Temporal provides a stronger durable-workflow platform but introduces separate platform and operational complexity before MVP evidence justifies it.

### C. BullMQ with Redis

BullMQ provides mature queue capabilities but adds Redis as a required persistence dependency.

## Why We Chose This

The selected mechanism keeps the MVP's durable work close to its authoritative state and avoids a second infrastructure dependency. The existing architecture retains a clear future migration path should measured workflow complexity justify a dedicated orchestration platform.

## Consequences

### Positive

- One persistence foundation for authoritative state and durable job delivery.
- Node/TypeScript background work remains aligned with the authoritative backend.
- No Redis or separate workflow platform is required for the MVP.

### Negative

- Complex long-lived workflows may eventually outgrow a job-queue model.
- Queue and domain-process records must remain intentionally distinct.

### Risks

- Treating queue-library defaults as product policy could violate approved retry or status rules.
- Poorly bounded job payloads or concurrency configuration could pressure the system-of-record database.

## Revisit Conditions

Reconsider if workflows require durable waiting, richer human-interaction state, independently scaled orchestration, or operational characteristics that `pg-boss` cannot meet safely.
