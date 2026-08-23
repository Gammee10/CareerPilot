# ADR-056: Use OCI Vault and Per-Container Compose Secrets

## Status

Accepted — 2026-08-23

## Context

The single-VM Docker Compose deployment needs sensitive credentials. ADR-028 requires capability-scoped external credential governance.

## Decision

- Use OCI Vault as the source of truth for private-beta production secrets.
- Retrieve secrets only during approved deployment or rotation procedures; do not commit them, bake them into images, or persist them in application configuration files.
- Inject each secret only into containers that require it through file-mounted Docker Compose secrets; do not use broadly inherited container environment variables for secret values.
- Scope OCI Vault access and mounted secrets to the necessary capability. The public frontend receives no server-side secrets; FastAPI receives no credentials unrelated to approved AI work.
- Apply ADR-028 rotation, revocation, audit, incident, and release-gate requirements.

This does not select retrieval scripts, OCI identity-policy details, secret names, rotation intervals, or CI/CD.

## Alternatives Considered

### A. OCI Vault with per-container Docker Compose secrets

Uses the approved hosting provider's Always Free secret-management capacity while limiting secret visibility by container. This is selected.

### B. Encrypted files on the VM

Simpler but weaker centralized access, rotation, and audit control.

### C. Paid third-party secret manager

Conflicts with the current $0 constraint.

## Revisit Conditions

Reconsider if deployment moves beyond the single VM, a reviewed CI/CD identity is introduced, or paid operations are approved.
