# ADR-017: Require Dual Authorization for Exceptional Administrator Access

## Status

Accepted — 2026-08-23

## Context

ADR-016 permits only controlled exceptional administrator access to sensitive user content for defined support, security, or legal incidents. That access must be purpose-limited, time-bounded, attributable, and audit-recorded. The remaining question is whether one administrator may authorize their own access or whether another authorized person must participate.

## Decision

Planned exceptional access requires approval by a different authorized administrator from the administrator requesting access. The request and approval must record the purpose, intended content scope, and time limit.

For urgent security incidents, immediate exceptional access is permitted only when waiting for prior approval would materially impede containment, investigation, or protection of users or the service. The acting administrator must record the reason and scope at the time of access. A different authorized administrator must promptly perform an independent retrospective review.

The emergency path must not be used for ordinary support convenience. This decision assumes the beta can designate at least two authorized administrators or an independent reviewer. If it cannot, a separately approved, narrowly constrained single-administrator fallback is required.

The precise review timing and request form remain operational details. Subsequent ADRs define user-notice and authorization-record retention policy.

## Alternatives Considered

### A. Self-authorized exceptional access

Permit any authorized administrator to authorize their own access and rely on subsequent audit. This is fast, but lacks separation of duties and makes misuse harder to deter or detect promptly.

### B. Dual authorization with an emergency retrospective-review path

Require another authorized administrator to approve planned access, while preserving immediate response to a genuine urgent security incident with mandatory independent review. This is the selected option.

### C. User consent before support access

Require user consent before access except in security or legal emergencies. This provides additional user control but can delay necessary support and still requires an emergency exception.

### D. Prohibit exceptional access

Eliminate internal content access entirely. This maximizes privacy but prevents practical investigation and support for defined incidents.

## Why We Chose This

The selected approach applies separation of duties to the normal case without impairing urgent incident response. It makes emergency use visible and accountable rather than creating an unreviewed bypass.

## Consequences

### Positive

- Planned access has independent oversight before sensitive content is exposed.
- Urgent incidents can be handled without waiting for unavailable approvers.
- Emergency exceptions create reviewable evidence rather than silently weakening the policy.

### Negative

- Planned support may take longer when an approver is unavailable.
- The beta needs at least two authorized administrators or an independent reviewer.

### Risks

- A vague definition of urgency could allow misuse of the emergency path.
- A nominal reviewer who does not independently assess access would undermine the control.
- A single-administrator beta cannot honestly satisfy the normal separation-of-duties policy without a specifically approved fallback.

## Revisit Conditions

Reconsider if the administrator operating model changes, if legal or regulatory obligations impose a different approval process, or if operational evidence shows the policy cannot support timely incident response safely.
