# ADR-003: Use Invite-Only Passwordless Email Access for the MVP

## Status

Accepted — 2026-08-18

## Context

The MVP is a private beta for invited users with individually isolated personal career data. It needs low-friction access without public registration or password-management burden.

## Decision

Use administrator-issued invitations and passwordless email links for account activation and sign-in. Public self-registration is disabled.

## Alternatives Considered

### A. Email and password accounts

Universally familiar but requires password storage, reset flows, and a larger credential-security surface.

### B. Invite-only passwordless email links

Low friction and eliminates application-managed passwords. This is the selected option.

### C. Invite-only third-party social sign-in

Convenient for some users but introduces identity-provider dependency and excludes users without a suitable account.

## Why We Chose This

It fits a small private beta, verifies the invited email address, and minimizes account-management complexity while retaining individual accounts.

## Consequences

### Positive

- No stored user passwords or password-reset flow.
- Invitation and verified identity are directly connected.
- Low onboarding friction.

### Negative

- Depends on reliable outbound email delivery.
- Users need access to the invited email inbox.

### Risks

- Email-link delivery, expiry, and replay behavior must be implemented securely.
- Future user populations may prefer additional identity methods.

## Revisit Conditions

Reconsider when public sign-up is introduced, email delivery proves unsuitable, enterprise identity is required, or supported users need another access method.
