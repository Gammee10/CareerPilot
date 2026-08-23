# ADR-031: Use Dual-Controlled Administrator-Role Lifecycle

## Status

Accepted — 2026-08-23

## Context

Administrators issue invitations, operate sources, inspect audits, approve exceptional access, and participate in incident response. ADR-017 requires dual authorization for planned exceptional user-content access. Administrator authority itself needs comparable protection against self-escalation, unilateral expansion, and accidental loss of all administrative control.

## Decision

- Administrator-role assignment, removal, and privilege alteration require dual control: one authorized administrator initiates the change and a different authorized administrator approves it.
- No person may approve their own elevation or privilege change.
- Initial bootstrap authority must be explicitly documented and audit-recorded.
- The final active administrator may not be removed until a replacement is active.
- Administrator-role assignment, removal, and attempted self-escalation are material audit events.
- The emergency exceptional-access path does not permit emergency self-granting of administrator authority.

This decision assumes at least two authorized administrators or an independent reviewer. It does not select an administrator interface, identity provider, or implementation mechanism.

## Alternatives Considered

### A. Unilateral administrator-role changes

Allow any existing administrator to grant, remove, or alter administrator authority alone. This is quick but creates a broad self-escalation and single-person-compromise path.

### B. Dual-controlled administrator-role changes

Require a different authorized administrator to approve role changes and prohibit self-approval. This is the selected option.

### C. Static deployment-managed administrator roles

Avoid in-product role changes by treating roles as static configuration. This reduces some in-product risk but makes governance opaque and operational recovery harder.

## Why We Chose This

The selected policy applies separation of duties to the power that governs all other administrator controls. It prevents emergency access from becoming a loophole for permanent privilege escalation and safeguards continuous operational ownership.

## Consequences

### Positive

- Administrator privilege changes receive independent oversight.
- Self-escalation and removal of the last active administrator are explicitly prevented.
- Bootstrap authority and role changes are reviewable through audit records.

### Negative

- Role changes require another authorized person or independent reviewer.
- The operating model must maintain at least two approvers or a documented reviewer relationship.

### Risks

- An unavailable second approver can delay a necessary role change.
- A weak bootstrap process can undermine all later dual-control safeguards.
- The policy may be bypassed in practice if privileged infrastructure access is not governed consistently.

## Revisit Conditions

Reconsider if the organization model, identity requirements, legal obligations, or administrator operating model materially change.
