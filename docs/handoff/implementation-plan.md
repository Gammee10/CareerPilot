# Implementation Plan — CareerPilot MVP

## Status

Approved handoff plan derived from accepted decisions (ADRs 001–060). No new architectural decisions are introduced here; where a detail is unspecified, the coding agent has implementation freedom within AGENTS.md invariants.

## Delivery Approach

Phases are ordered so that security foundations precede data flows, and every phase ends with runnable, verifiable software. Phases 1–2 are prerequisites for all user-facing behavior. Phase 9 is the ADR-030 release-validation gate; no beta onboarding before it passes.

## Phase 1 — Foundation

Repository structure, Docker Compose baseline (frontend, backend, worker, FastAPI, PostgreSQL, Caddy), PostgreSQL schema and migrations implementing `docs/domain-model.md`, configuration handling, OCI Vault → Compose file-mounted secrets wiring, local development environment.

Key references: ADR-047, 048, 050, 055, 056.

## Phase 2 — Identity, Invitations, Sessions

Custom passwordless identity: invitation lifecycle (`issued`/`accepted`/`expired`/`revoked`), opaque single-use links with confirmation-before-redemption, link validity and issuance limits, session lifetimes and revocation, account states (`active`/`suspended`/`closed`), dual-controlled administrator role changes, deny-by-default resource-level authorization middleware.

Key references: FR-0, FR-0b; ADR-003, 009, 016–018, 025–027, 031, 036, 051.

## Phase 3 — Profile and Resume Processing

Resume upload to private Object Storage via short-lived scoped authorization, FastAPI extraction task through the Node-owned background path with ADR-054 minimization, reviewable draft workflow, editable profile with immutable profile versions, hard-constraint/preference classification, free-text preferences.

Key references: FR-1–FR-7, FR-0a; ADR-002, 005, 013, 020, 022, 029, 054.

## Phase 4 — Source Adapters and Shared Job Pipeline

Greenhouse, Lever, RemoteOK adapters emitting provenance-preserving immutable observations; normalization, conservative canonicalization, availability processing stages; preferred/alternative application-link selection; material-change classification; per-adapter enable/disable and limit enforcement (rate limits, page budgets, timeouts, bounded transient-only retry, `Retry-After`).

Precondition: record each source's current-terms validation before first use (ADR-059/060 OPEN items).

Key references: FR-10a–c, FR-16, FR-17a; ADR-001, 004, 006, 007, 011–012, 021, 037–039, 044, 046, 059.

## Phase 5 — Discovery Orchestration and Background Work

pg-boss integration implementing approved policies (not library defaults): per-user time-zone daily scheduling, guarded manual refresh, single-active-run + coalescing, discovery-run/source-attempt process records with truthful partial status, idempotency identities, supersession checks, active-account verification, suspension/closure work stoppage, URL-import analysis path.

Key references: FR-8–FR-13; ADR-008, 010, 042–045, 049.

## Phase 6 — Hybrid Evaluation and Explanation

Deterministic eligibility/hard-constraint assessment; AI-assisted interpretation via minimized Gemini requests with Node-side validation; named dimension scores, evidence-linked explanations, uncertainty labeling; immutable versioned evaluation snapshots tied to profile version + job observation; ranking with transparent penalties; bounded re-evaluation after material profile change; compatible-current-result selection.

Key references: FR-4, FR-6, FR-14–FR-24; ADR-002, 013, 029, 040–041, 054.

## Phase 7 — Dashboard (Next.js)

User-scoped query/command boundary; new-jobs ranked view, job-detail evidence view, save/not-interested actions, search-term viewing/editing, manual refresh with truthful status, profile editing with re-evaluation indicators, data-use disclosure and acknowledgement flows, closure request with fresh passwordless confirmation.

Key references: FR-14–FR-17a, FR-22–FR-24, Flows 1–7; ADR-014, 035, 036.

## Phase 8 — Operations

Structured JSON logging under minimization rules with rotation, container health endpoints, health-check script (containers/disk/PostgreSQL/daily-backup success), Resend administrator alerts within amended scope, daily encrypted backup pipeline with integrity checks, restore runbook with deletion-replay check, monthly restore drill procedure, retention-enforcement jobs for all category schedules.

Key references: ADR-015, 019–021, 024, 052, 057, 058.

## Phase 9 — Release-Validation Gate (ADR-030)

Produce evidence for: unauthenticated denial, user-to-user isolation, administrator least privilege, invitation/link/session/suspension/revocation behavior, exceptional-access authorization and auditability, retention/deletion/recovery-copy/preservation-hold behavior, telemetry/audit minimization, absence of secrets from diagnostics, source and external-processor restrictions, adversarial untrusted-content resistance. No beta onboarding until complete.
