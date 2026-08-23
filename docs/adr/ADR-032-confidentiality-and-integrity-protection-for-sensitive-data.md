# ADR-032: Require Confidentiality and Integrity Protection for Sensitive Data

## Status

Accepted — 2026-08-23

## Context

The MVP limits access through authorization, purpose-scoped processing, and credential governance, but access control alone does not protect data if a storage or transport boundary fails. Resumes, profiles, evaluations, authentication and session records, audit records, exceptional-access records, credentials, and incident diagnostics are sensitive. Shared source data can also be subject to contractual restrictions.

## Decision

- Protect sensitive user data, credentials, and security records for confidentiality and integrity both in transit between approved boundaries and at rest while retained.
- Apply this protection to resumes, profiles, evaluations, authentication and session records, audit and exceptional-access records, credentials, and retained sensitive incident diagnostics.
- Protect shared source data according to its source restrictions and sensitivity.
- Restrict cryptographic-key access separately from ordinary application access and limit it to the minimum components or roles that require it.
- Exclude keys from routine logs, audit events, and source code.

This ADR does not select cryptographic algorithms, key-management systems, rotation intervals, infrastructure products, or implementation mechanisms.

## Alternatives Considered

### A. Application authorization controls only

Rely on authorization while leaving storage and transport protection implicit. This has low explicit scope but provides inadequate defense if another infrastructure boundary fails.

### B. Confidentiality and integrity protection in transit and at rest with separate key access

Require a strong baseline for sensitive data and credentials without requiring a particular product or cryptographic design. This is the selected option.

### C. Field-level protection for every record and data flow

Require maximum-granularity protection everywhere. This may be justified for some future data classes but prematurely constrains the MVP and adds disproportionate complexity.

## Why We Chose This

The selected baseline complements the accepted access controls and sensitive-data minimization policies without choosing technology prematurely. Separate key access prevents ordinary application access from automatically equating to key authority.

## Consequences

### Positive

- Sensitive data retains protection beyond the application authorization layer.
- Credential and key exposure risks are explicitly controlled.
- Source-restriction obligations remain relevant to shared data handling.

### Negative

- The future implementation must design key lifecycle and boundary protection deliberately.
- Some operational diagnostics and recovery procedures need to work within protected-data controls.

### Risks

- Poor key-access scoping can nullify the intended separation.
- Incomplete coverage could leave an unnoticed sensitive data class unprotected.
- Protection failures can complicate recovery and incident investigation.

## Revisit Conditions

Reconsider if data classifications, source contracts, legal obligations, or future organization/enterprise requirements require more granular protection.
