# ADR-009: Use a Dedicated Authentication and Invitation Capability

## Status

Accepted — 2026-08-21

## Context

ADR-003 requires administrator-issued invitations and passwordless email links for a private beta with individually isolated user accounts. Access behavior is security-sensitive and must be distinct from the dashboard, career-profile, and job-processing responsibilities.

The MVP does not include product notifications, but it necessarily requires transactional delivery of passwordless access links.

## Decision

Create a dedicated logical authentication and invitation capability. It shall own:

- invitation issuance and lifecycle;
- passwordless access-link lifecycle;
- account and authenticated-session identity; and
- access and isolation decisions.

The web application shall consume authenticated identity. Other product capabilities shall not own invitation validity, authentication credentials, or session policy. Transactional authentication emails are within this capability's scope and are not product notifications.

This decision does not choose an identity provider, email-delivery provider, session mechanism, administrator interface, or detailed access-link controls.

## Alternatives Considered

### A. Dashboard-owned access flows

This initially appears simpler but mixes sensitive identity and invitation policy with product-interface and profile responsibilities.

### B. Dedicated authentication and invitation capability

This gives identity, invitation, and access policy an explicit owner while allowing the dashboard and domain capabilities to remain focused. This is the selected option.

### C. Delegate all identity behavior to an external identity boundary

This may reduce application-managed identity handling, but it is a later implementation/provider decision and does not itself define invitation or administration policy.

## Why We Chose This

The selected boundary best supports invite-only access, individual-account isolation, consistent security controls, and future flexibility without selecting a technology or provider prematurely.

## Consequences

### Positive

- A single logical owner governs access and invitation policy.
- Product capabilities do not duplicate authentication behavior.
- Transactional access delivery is clearly distinguished from out-of-scope product notifications.

### Negative

- The capability requires explicit contracts with the dashboard and administration workflows.
- Detailed security controls and delivery failure handling still need definition.

### Risks

- Inconsistent resource-level authorization outside this capability could still violate data isolation.
- Poor link lifecycle or email-delivery design could undermine the passwordless access experience.

## Revisit Conditions

Reconsider if product scope introduces enterprise identity, public registration, supported alternative access methods, or an organization/tenant model that requires materially different identity boundaries.
