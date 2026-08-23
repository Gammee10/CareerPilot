# ADR-028: Use Capability-Scoped External Credential Governance

## Status

Accepted — 2026-08-23

## Context

Authorized source adapters, transactional authentication delivery, and any approved external processors require credentials. The MVP's security boundary already requires least-privilege access, auditability, and sensitive-data minimization. Treating credentials as broadly available ordinary configuration would undermine these decisions and make compromise response harder.

## Decision

- Treat secrets and external credentials as a distinct security-governed data class.
- Make a credential available only to the runtime capability that requires it; source-adapter credentials are unavailable to unrelated capabilities.
- Use unique, scoped credentials per external integration and operational environment where possible; do not casually share or reuse them.
- Exclude secrets from source code, user-facing responses, telemetry, audit events, and ordinary diagnostics.
- Treat issuance, rotation, revocation, access-policy changes, and suspected compromise as material security events.
- On suspected compromise, promptly revoke or rotate the credential and disable the affected integration where necessary until safe operation resumes.
- Do not let third-party credentials expand the purpose-scoped user-data access policy of ADR-022.

This ADR does not select secret-storage products, deployment products, key-management systems, or implementation mechanisms.

## Alternatives Considered

### A. Ordinary broadly available runtime configuration

Make secrets available wherever application configuration is read. This lowers setup effort but weakens isolation and increases accidental disclosure risk.

### B. Capability-scoped credential governance

Treat secrets as a separate security class with narrow capability access, rotation and revocation expectations, and auditability. This is the selected option.

### C. User-supplied credentials for every external service

Avoid platform-held integration credentials by requiring users to supply them. This is incompatible with the authorized-source portfolio and creates undue user burden.

## Why We Chose This

The selected policy prevents credentials from becoming an uncontrolled shared dependency. It supports source-adapter isolation and makes compromise response a defined operational action rather than an ad hoc deployment problem.

## Consequences

### Positive

- Credentials follow capability boundaries rather than application-wide convenience.
- Compromise response and lifecycle changes are auditable.
- External integration credentials cannot implicitly broaden user-data access.

### Negative

- Each integration needs explicit credential ownership and lifecycle handling.
- Operational changes may require coordinated credential rotation or adapter disablement.

### Risks

- Overly broad runtime access can still defeat the policy.
- Rotation failures can interrupt source collection or authentication delivery.
- Inadequate compromise detection can delay containment.

## Revisit Conditions

Reconsider if the product adds user-provided integrations, new runtime roles, enterprise credential requirements, or operational evidence shows a different scope or rotation model is necessary.
