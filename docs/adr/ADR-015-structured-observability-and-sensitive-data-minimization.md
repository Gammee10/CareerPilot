# ADR-015: Structured Observability and Sensitive-Data Minimization

- Status: Accepted
- Date: 2026-08-23

## Context

The MVP combines interactive requests with durable background processing across invitation access, discovery, source collection, job processing, matching, and user review. It must communicate truthful status, diagnose partial failures, trace explainable evaluations, and preserve individual-account isolation. Resume files, career profiles, job content, and AI-derived content are sensitive or subject to source-use restrictions.

## Decision

Use cross-cutting, structured operational telemetry with correlatable identifiers and a distinct audit-event model. Telemetry shall cover material lifecycle outcomes, including invitation and access events; discovery runs and source attempts; job-processing outcomes; evaluations and re-evaluations; and user review actions. It shall support reliability, source-coverage, latency, retry, deduplication, and evaluation-traceability investigation.

Audit events shall record material security, isolation, administration, and user-impacting actions. Routine telemetry and audit events shall exclude raw resumes, profile content, full job text, and AI inputs or outputs by default. Any diagnostic context retained must be minimized, redacted or summarized as appropriate, access-controlled, and subject to applicable retention and source-use restrictions.

This ADR does not select observability products, retention durations, or implementation technology.

## Alternatives Considered

### A. Conventional component logs only

Low initial effort, but inadequate for explaining failed runs, source coverage, deduplication outcomes, and user-visible results.

### B. Structured correlatable telemetry, separate audit events, and sensitive-data minimization

Selected. It enables trustworthy operation and diagnosis without making observability a second unprotected copy of sensitive data.

### C. Capture complete request, source, resume, profile, and AI payloads for every event

Useful for debugging, but creates disproportionate privacy, security, retention, and compliance risk.

### D. Separate uncorrelated logs per capability

Preserves local ownership but prevents effective end-to-end diagnosis and weakens truthful status reporting.

## Consequences

Capabilities must emit consistent lifecycle and correlation information while remaining accountable for sensitive-data handling. Operational views can connect related work across the interactive/control-plane and background-work roles established by ADR-008. Detailed retention, access policy, and incident-response procedures remain subsequent security and operational design work.
