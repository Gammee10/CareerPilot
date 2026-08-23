# ADR-011: Source Adapters Emit Provenance-Preserving Observations

- Status: Accepted
- Date: 2026-08-22

## Context

ADR-001 requires a hybrid, compliance-first source policy with adapter isolation. Sources differ in authorization, terms, schema, rate limits, job content, and application links. ADR-004 establishes canonical jobs and source listings as distinct shared records, while ADR-006 requires layered conservative deduplication.

## Decision

Each authorized source adapter shall own source-specific collection, including terms-aware access, rate-limit behavior, source schema interpretation, error reporting, and provenance capture. It shall emit a source-specific observation through a shared source-listing contract.

Shared normalization validates and translates that observation into common job and source-listing representations. Shared downstream processing owns conservative canonicalization, not individual adapters. Source-specific restrictions on retention, sharing, or display must accompany the observation and be enforced downstream.

This ADR does not authorize collection or data use beyond a source's permitted terms, and does not select sources or implementation technologies.

## Alternatives Considered

### A. Adapters emit fully normalized jobs

This makes the immediate downstream path simple, but spreads common job-model policy across adapters and invites inconsistent normalization.

### B. Adapters emit source-specific observations under a shared source-listing contract

Selected. It localizes source-specific compliance and schema handling while centralizing common normalization and canonicalization.

### C. Each adapter owns normalization and canonicalization

This maximizes adapter autonomy, but duplicates deduplication logic and conflicts with the shared canonical-job model.

### D. One generic universal collector

This reduces apparent surface area but does not support the authorized, source-specific compliance policy.

## Consequences

The shared contract must carry sufficient provenance and applicable use restrictions. Adapters remain independently enableable, disableable, and replaceable. Normalization and deduplication can apply one consistent interpretation of shared job and source-listing records without overriding source obligations.
