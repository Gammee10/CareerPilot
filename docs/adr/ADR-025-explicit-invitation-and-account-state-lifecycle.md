# ADR-025: Use an Explicit Invitation and Account-State Lifecycle

## Status

Accepted — 2026-08-23

## Context

ADR-003 establishes invite-only access; ADR-009 assigns invitation and account identity to a dedicated capability; ADR-018 hardens access-link redemption; and ADR-020 defines account closure and deletion behavior. The MVP needs clear, auditable behavior when an invitation is not used, access must stop temporarily, or an account must be closed.

## Decision

- Invitation lifecycle states are `issued`, `accepted`, `expired`, and `revoked`.
- An invitation is bound to its invited email; changing the recipient requires revocation and re-issuance.
- Account lifecycle states are `active`, `suspended`, and `closed`.
- Only an active account may authenticate or receive scheduled discovery and re-evaluation work.
- Suspending an account immediately blocks new sessions and pauses user-specific background work while retaining data under the approved retention policy.
- Closing an account immediately blocks access and begins the 30-day active-system deletion lifecycle of ADR-020.
- A closed account is not reopened; renewed access requires a new invitation and account rather than reversal of deletion processing.
- Invitation issuance, expiry, revocation, acceptance, account suspension or restoration, and closure are material audit events.

Exact invitation and access-link validity periods and issuance limits are defined by ADR-026.

## Alternatives Considered

### A. Implicit activated-or-not account status

Treat accounts as activated or not and handle revocation and closure ad hoc. This minimizes modeled states but makes security and operational behavior unclear.

### B. Explicit invitation and account states with audited transitions

Model invitation outcomes and active, suspended, and closed accounts explicitly. This is the selected option.

### C. Permanently delete accounts whenever access must stop

Use deletion for all access removal. This enforces access cessation but is unsuitable for reversible security or support actions and conflicts with the bounded deletion lifecycle.

## Why We Chose This

The selected model provides clear, testable access and background-work behavior. It distinguishes temporary containment from permanent closure and prevents a completed deletion workflow from being casually reversed.

## Consequences

### Positive

- Access revocation and processing pause behavior are explicit.
- Administrators can contain risk through suspension without immediately deleting data.
- Account closure has a clear security and deletion outcome.

### Negative

- Authentication and orchestration must respect lifecycle state consistently.
- A user who closes an account cannot simply reactivate it.

### Risks

- Inconsistent state enforcement could leave suspended users able to access data or consume background work.
- Incorrectly closing instead of suspending an account can start irreversible deletion.
- Invitation recipient changes require a deliberate re-issuance process.

## Revisit Conditions

Reconsider if the product introduces organizations, delegated administration, account recovery requirements, or a supported need to restore closed accounts before deletion completes.
