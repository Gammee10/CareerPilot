# ADR-050: Use Private S3-Compatible Object Storage for Sensitive Artifacts

## Status

Accepted — 2026-08-23

## Context

Raw resumes and related large artifacts are sensitive user-owned content with dedicated retention, deletion, recovery-copy, and access-control requirements. PostgreSQL is the authoritative record store but is not the preferred boundary for large files. The MVP needs private artifact storage that works across separately operable runtime roles without prematurely binding the architecture to one provider.

## Decision

- Store raw resumes and other large user-owned artifacts in private, S3-compatible object storage rather than PostgreSQL.
- Retain only artifact metadata and object references in PostgreSQL.
- Require encryption at rest, protected in-transit transfer, and short-lived, purpose-scoped upload and download authorization.
- Require the selected provider to support approved confidentiality, integrity, deletion, recovery-copy, and access-control requirements.
- Require ADR-033 external-processor approval before an object-storage provider receives user data.
- Preserve S3-compatible access to retain provider portability.

This ADR does not select an object-storage provider, region, encryption or key-management product, upload/download implementation, retention configuration, or deployment product.

## Alternatives Considered

### A. Private S3-compatible object storage

Store artifacts outside PostgreSQL through a portable object-storage interface. This is the selected option.

### B. PostgreSQL large objects or blobs

Keep files and transactional data together, but couple large-file access, backup, and lifecycle concerns to the system-of-record database.

### C. Local filesystem storage

Simple for local development but unsuitable for independently operable runtime roles and approved recovery requirements.

## Why We Chose This

The selected boundary separates large sensitive artifacts from the transactional data model, enables controlled short-lived access, and preserves provider flexibility until a reviewed processor is selected.

## Consequences

### Positive

- Large files do not burden the authoritative database.
- Artifact access can be narrowly scoped and short-lived.
- The storage interface remains portable across approved providers.

### Negative

- Artifact metadata and object lifecycle must remain consistent.
- A second persisted storage system requires governance and operational controls.

### Risks

- Incorrect object authorization could expose sensitive resumes.
- A provider's deletion or recovery-copy behavior could conflict with the approved lifecycle.

## Revisit Conditions

Reconsider if source or user-content volume requires a different storage class, provider constraints prevent S3-compatible access, or approved data-residency requirements change.
