# ADR-036: Require Fresh Confirmation for Account Closure and Deletion

## Status

Accepted — 2026-08-23

## Context

ADRs 020 and 025 define bounded deletion and a non-reopenable closed-account state. The system needs a clear way for the account owner to submit a valid closure request without allowing a stale or hijacked session to irreversibly trigger deletion. The MVP's no-routine-administrator-access policy also favors a direct user path rather than support-only deletion handling.

## Decision

- Only an account owner may self-initiate account closure and deletion.
- The dashboard presents a clear impact warning and requires confirmation through a newly redeemed passwordless link for that account.
- After confirmation, access and user-specific background work stop immediately and the approved deletion lifecycle begins.
- The user receives confirmation and truthful deletion-status information.
- An administrator may suspend access for operations or security, but may close an account only for a documented user request, legal obligation, or security reason, with an audit record.
- No self-service cancellation is available after closure confirmation.

This ADR does not select interface, notification-delivery, authentication, or implementation technology.

## Alternatives Considered

### A. Support-only manual deletion requests

Require users to contact support for closure and deletion. This simplifies the dashboard but delays a sensitive request and depends on internal handling.

### B. Self-service closure with fresh passwordless confirmation

Allow the account owner to start closure in the dashboard, require a newly redeemed link to confirm it, and immediately begin the approved deletion lifecycle. This is the selected option.

### C. One-click deletion from any active session

Make closure immediate from an existing session. This is fast but too vulnerable to accident or session compromise.

## Why We Chose This

The selected path gives the account owner a direct, reliable deletion route while requiring fresh proof of inbox control before an irreversible lifecycle transition. It is consistent with passwordless access and avoids routine administrator inspection of user content.

## Consequences

### Positive

- Closure requests have a clear owner-authentication safeguard.
- Access and background work stop immediately after confirmation.
- Users receive status rather than an opaque support-only process.

### Negative

- A user must access their email inbox to complete closure.
- No self-service recovery is available after confirmation.

### Risks

- Loss of inbox access can prevent a user from completing self-service closure.
- A compromised inbox can authorize closure, like other passwordless actions.
- Misleading status could undermine the deletion commitment.

## Revisit Conditions

Reconsider if legal obligations require a different request-verification process, users need a supported cancellation window, or account-recovery requirements change.
