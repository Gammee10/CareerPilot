# ADR-053: Use Oracle Cloud Always Free for Cost-Constrained Private-Beta Hosting

## Status

Accepted — 2026-08-23

## Context

The private beta must operate at $0 cost for now. The selected architecture requires containerized Next.js, Express, Node worker, FastAPI, PostgreSQL, and private S3-compatible artifact storage. AWS was considered but rejected because free-tier expiry and overage risk conflict with the $0 constraint.

## Decision

- Use Oracle Cloud Always Free as the private beta's $0 hosting foundation.
- Run the containerized Next.js frontend, Express backend, Node background worker, internal FastAPI capability, and self-managed PostgreSQL on one Always Free Arm virtual machine.
- Use OCI Object Storage for the approved private S3-compatible artifact boundary.
- Treat this as a cost-constrained private-beta posture, not a production availability promise.
- Own PostgreSQL operations, recovery verification, container deployment, host hardening, and operational monitoring on the single VM.
- Preserve a later migration path to managed infrastructure through the existing containers and PostgreSQL/S3-compatible boundaries.
- Record the approved OCI region and services through ADR-033's processor review before onboarding.
- Do not silently exceed Always Free limits; capacity shortage, idle-instance reclamation, or a need for paid usage requires a new hosting review.

This ADR does not select an OCI region, VM operating system, container runtime, deployment automation, backup implementation, monitoring product, or external AI provider.

## Alternatives Considered

### A. Oracle Cloud Always Free

Use an Always Free Arm VM and OCI Object Storage within published free limits. This is the selected option.

### B. AWS managed foundation

Offers mature managed services but introduces free-tier expiry and paid-overage risk.

### C. Multiple developer-oriented free tiers

May reduce host administration but fragments provider governance and can impose sleeping, quota, or paid-upgrade constraints across runtime roles.

## Why We Chose This

Oracle Cloud Always Free can support the selected container and object-storage boundaries without immediate paid hosting. It keeps the deployment small and makes cost exposure explicit while preserving an intentional future migration path.

## Consequences

### Positive

- The private beta can be hosted without planned cloud spend.
- One provider covers compute, private networking, and S3-compatible artifact storage.
- The architecture remains portable to future managed infrastructure.

### Negative

- PostgreSQL and runtime operations are self-managed.
- One VM is a single availability and maintenance boundary.
- Always Free capacity and lifecycle constraints can affect availability.

### Risks

- Free Arm capacity may be unavailable in the chosen home region.
- An idle instance may be reclaimed under Oracle's policy.
- Resource growth beyond the free limits requires an explicit redesign or paid-hosting decision.

## Revisit Conditions

Reconsider before public launch, when availability or recovery requirements increase, if Always Free capacity is unavailable or reclaimed, or before any paid usage is introduced.
