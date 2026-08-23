# ADR-051: Implement Policy-Controlled Passwordless Identity in Express and PostgreSQL

## Status

Accepted — 2026-08-23

## Context

The approved MVP access policy requires invite-only access, opaque one-time passwordless links, 15-minute sign-in-link expiry, a confirmation step before redemption, bounded sessions, immediate revocation, and distinct invitation/account states. Managed identity providers can accelerate integration but may impose link redemption, expiry, or browser-device behavior that conflicts with this policy.

## Decision

- The Node.js/Express authentication and invitation capability shall implement the MVP passwordless identity lifecycle using PostgreSQL.
- It owns invitation issuance and revocation, opaque one-time access-link issuance, confirmation before redemption, session lifecycle, suspension/closure revocation, and applicable audit records.
- A separate transactional-email provider may deliver the resulting messages but does not own identity, invitation validity, access-link redemption, account state, or session policy.
- The implementation remains subject to the approved security and privacy release-validation gate.

This ADR does not select an email provider, token format, cryptographic library, session mechanism, email template, or implementation code.

## Alternatives Considered

### A. Policy-controlled passwordless identity in Express and PostgreSQL

Implement the approved lifecycle in the authoritative backend while using email only as delivery. This is the selected option.

### B. Managed identity provider

This reduces implementation work but may impose magic-link behavior inconsistent with the approved confirmation-before-redemption and validity policies.

## Why We Chose This

The selected option makes the already-approved access policy enforceable without depending on a provider's fixed link lifecycle. It confines custom identity scope to the MVP's defined passwordless flow rather than creating a general identity platform.

## Consequences

### Positive

- The product retains control of exact invitation, link, confirmation, session, and revocation behavior.
- Transactional-email delivery can be replaced without changing identity semantics.
- The implementation directly aligns with the approved security ADRs.

### Negative

- The project owns security-sensitive implementation and testing work.
- The authentication capability needs disciplined operational monitoring and incident response.

### Risks

- An implementation defect could undermine link or session security.
- Email delivery failures remain an external dependency even though identity state is internal.

## Revisit Conditions

Reconsider if a managed provider can demonstrably satisfy the full approved policy, authentication scope expands materially, or operations require a provider-backed identity service.
