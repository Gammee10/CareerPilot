# ADR-048: Use PostgreSQL as the Authoritative System of Record

## Status

Accepted — 2026-08-23

## Context

The MVP domain has strongly related and transactional state: individual-account isolation, immutable profile and evaluation versions, source observations, canonical-job reconciliation, derived current views, availability history, discovery work records, idempotency records, and audit metadata. It also retains permitted source-specific fields whose shapes can vary. The system needs one authoritative consistency boundary without the operational and reconciliation overhead of multiple databases.

## Decision

- PostgreSQL shall be the sole authoritative system of record for the MVP.
- It shall store account state, immutable profiles and evaluations, source-listing observations, canonical jobs and reconciliation records, availability history, discovery runs and attempts, user review state, audit metadata, and idempotency records.
- Related authoritative state changes shall use PostgreSQL transactional consistency.
- Where source restrictions permit, flexible source-specific evidence and normalized fields may be retained in `jsonb` alongside the relational model.
- No second document database is introduced for the MVP.
- Raw resumes and other large artifacts remain outside PostgreSQL and require separately approved object storage.

This ADR does not select a PostgreSQL provider, version, schema or migration tooling, connection-management mechanism, object-storage provider, backup product, or implementation library.

## Alternatives Considered

### A. PostgreSQL as the sole relational system of record

Use relational records for authoritative state and `jsonb` for permitted variable-shaped evidence. This is the selected option.

### B. MongoDB as the system of record

This offers flexible document storage and transactions, but the MVP's many cross-record relationships and invariants would require more multi-document coordination.

### C. PostgreSQL plus a document database from the start

This adds specialized flexibility but introduces a second consistency and operational boundary before it is justified.

## Why We Chose This

PostgreSQL provides a single transactional home for the MVP's relational and immutable-record model while retaining sufficient flexibility for permitted source-specific evidence. The decision supports the approved isolation, provenance, current-view, and durable-work policies without premature datastore specialization.

## Consequences

### Positive

- One authoritative consistency boundary for the MVP.
- Strong support for relational integrity and transactional state changes.
- Flexible permitted evidence can remain adjacent to its relational provenance.

### Negative

- Schema design and indexing need deliberate care as source evidence grows.
- Large binary artifacts require a separate storage capability.

### Risks

- Treating `jsonb` as an ungoverned substitute for the relational model could weaken integrity and queryability.
- Source restrictions may limit which evidence may be retained regardless of database capability.

## Revisit Conditions

Reconsider if evidence volume or access patterns show a separate specialized store is necessary, source restrictions require a different isolation model, or measured scale exceeds a single PostgreSQL system-of-record boundary.
