# AGENTS.md — CareerPilot Coding-Agent Instructions

## Purpose

This repository is implemented from an approved architecture. You (the coding agent) implement the accepted decisions precisely. You do **not** make architectural decisions, choose external providers or cloud services, expand data scopes, or introduce new external processors. If you encounter ambiguity that requires an architectural choice, stop and surface it instead of deciding.

## Authoritative Documents (read before implementing)

```text
docs/product-definition.md        — product intent, scope, non-goals
docs/requirements.md              — approved functional requirements FR-0 … FR-24
docs/user-flows.md                — approved flows and failure expectations
docs/domain-model.md              — approved domain entities and lifecycle rules
docs/architecture.md              — accepted system-architecture decisions
docs/adr/ADR-001 … ADR-060       — accepted architecture decisions (all binding)
docs/handoff/implementation-plan.md — phased delivery plan
docs/handoff/tasks.md             — task breakdown with acceptance criteria
```

## Session Continuity (mandatory)

Before writing any code in a session, read in order: `AGENTS.md`, then `docs/dev/current-state.md` (what exists now, blockers, next step), then the newest entries of `docs/dev/session-log.md`. Before a session ends, update `current-state.md` to reflect reality and prepend one entry to `session-log.md` (done, verified, deviations, next step). Protocol details: `docs/dev/README.md`. If code and dev docs disagree, fix the dev docs immediately.

## Approved Stack (do not substitute)

- Next.js + TypeScript frontend (presentation only; no durable background work)
- Node.js + TypeScript + Express authoritative backend (commands, queries, orchestration, persistence coordination)
- Internal FastAPI/Python AI capability (non-public; purpose-scoped AI tasks only)
- PostgreSQL — sole authoritative system of record
- pg-boss (PostgreSQL-backed) — durable Node background work
- OCI Object Storage (S3-compatible) — private artifact storage + backup bucket
- Custom Express/PostgreSQL passwordless identity (no managed IdP)
- Resend — restricted transactional email + amended administrator operational alerts
- Oracle Cloud Always Free: one Ubuntu LTS VM, Docker Compose, Caddy
- OCI Vault + file-mounted per-container Compose secrets
- Gemini unpaid tier — ONLY through the FastAPI capability with the ADR-054 minimization boundary

## Non-Negotiable Invariants

These come from accepted ADRs and must hold in every implementation:

1. **Isolation**: deny-by-default, resource-level authorization; users access only their own records (architecture §Authorization).
2. **Identity**: invite-only; passwordless links opaque, single-use, 15-minute sign-in validity, confirmation-before-redemption, non-disclosing failures (ADRs 018, 026).
3. **Sessions**: 30-day absolute/7-day idle (users); 12-hour absolute/1-hour idle (admins); immediate revocation on suspension/closure (ADR-027).
4. **Sensitive-data minimization** (ADR-015): no resumes, profile content, full job text, or AI inputs/outputs in logs, telemetry, or audit events.
5. **AI boundary** (ADR-054, architecture §Untrusted-Content): source/resume content is untrusted evidence; AI output is an untrusted proposal validated Node-side; never send identifiers (names, emails, phones, account IDs, filenames, profile URLs) to Gemini; hard constraints are deterministic and cannot be overridden by AI output.
6. **Background work**: all durable work through pg-boss with explicit idempotency identities, supersession checks, active-account verification (ADR-045); coalescing per ADR-042; bounded transient-only retry honoring source policy (ADR-044); partial results preserved truthfully (ADR-043).
7. **Immutability**: source-listing observations, profile versions, evaluation snapshots, audit events are append-only; current views are derived (ADRs 005, 013, 037).
8. **Retention**: enforce category schedules (ADRs 020, 021): 30-day raw-resume grace, 30-day closure deletion, 90-day recovery copies, 180-day shared job data, 90-day telemetry, 12-month audit, 24-month exceptional-access records.
9. **Secrets**: OCI Vault sourced; file-mounted Compose secrets; never committed, logged, baked into images, or broadly inherited env vars (ADR-056, ADR-028).
10. **Sources**: only Greenhouse, Lever, RemoteOK public APIs + user URL import (ADR-059). Never scrape LinkedIn/Indeed. Conservative rate limits, `Retry-After` honored, bounded pages/attempts. Each adapter independently disableable.
11. **Backups**: daily encrypted `pg_dump` to dedicated backup bucket; 90-day lifecycle; post-upload integrity check; monthly restore drill with deletion-replay check (ADR-057).
12. **Deletion**: closure blocks access/work immediately; deletion re-applied on any restore (ADR-024, ADR-036).

## Implementation Freedom (do not over-specify)

Unless a document states otherwise, you may choose: libraries, internal module/file structure, exact log tooling, migration tooling, token generation library, HTTP client, template engine, test framework. Choices must satisfy the invariants above; if none can, stop and report.

## OPEN at implementation start (verify, then proceed)

- Verify current Gemini unpaid-tier terms match the ADR-060 record; deviation → halt AI features, report.
- Verify Greenhouse/Lever/RemoteOK current API terms per ADR-059; each adapter's validation is recorded before its first use.

## Verification Expectations

Every phase in `docs/handoff/tasks.md` lists acceptance criteria. Tests must demonstrate: isolation between accounts, link/session lifecycle rules, idempotent retry behavior, partial-run status truthfulness, retention enforcement, minimization of logs/telemetry, and deterministic hard-constraint precedence. The final phase implements the ADR-030 release-validation evidence checklist.
