# ADR-027: Use Bounded Authenticated Sessions and Immediate Revocation

## Status

Accepted — 2026-08-23

## Context

ADRs 018 and 026 secure passwordless-link issuance and redemption, but the authenticated session created after redemption also controls access to sensitive user data and privileged administration. ADR-025 establishes suspension and closure states, and ADR-023 requires active incident containment. Session lifetime and revocation behavior must be explicit without selecting an identity or session technology.

## Decision

- An individual user's authenticated session has a 30-day absolute lifetime and expires after seven days of inactivity.
- An administrator's authenticated session has a 12-hour absolute lifetime and expires after one hour of inactivity.
- A new passwordless link is required after session expiry or revocation.
- All sessions end immediately when the associated account is suspended or closed, when administrator authority is removed or suspended, or when incident containment requires revocation.
- Session creation, revocation, and privileged-session expiry are material audit events. Ordinary user-session expiry does not create a noisy audit event.

This ADR does not select session storage, token format, identity technology, or implementation mechanisms.

## Alternatives Considered

### A. Indefinite sessions until manual sign-out

This minimizes recurring sign-in friction but leaves sensitive user and administrator access exposed for an unacceptable duration.

### B. Bounded user and shorter privileged sessions with immediate revocation

Use a 30-day absolute and seven-day idle limit for users, a 12-hour absolute and one-hour idle limit for administrators, and immediate revocation for security-relevant state changes. This is the selected option.

### C. Twenty-four-hour sessions for all roles

This offers stronger exposure reduction but requires frequent passwordless re-authentication and is disproportionate for ordinary private-beta users.

## Why We Chose This

The selected policy balances low-friction user access with materially stronger controls for privileged administration. Immediate revocation makes account state and incident containment meaningful rather than waiting for normal session expiry.

## Consequences

### Positive

- Privileged authority has a substantially shorter exposure window than ordinary user access.
- Suspension, closure, and incident actions promptly stop existing access.
- Session behavior is testable independently of implementation technology.

### Negative

- Users and especially administrators must periodically re-authenticate.
- The authentication capability must propagate revocation consistently to all access paths.

### Risks

- A 30-day user lifetime may still be too long for some future user populations.
- Incorrect idle-time tracking can unexpectedly interrupt valid users or fail to expire inactive sessions.
- Delayed revocation propagation could leave a temporary access window during an incident.

## Revisit Conditions

Reconsider if access-abuse evidence, user expectations, additional authentication factors, enterprise requirements, or identity-provider capabilities justify different lifetimes.
