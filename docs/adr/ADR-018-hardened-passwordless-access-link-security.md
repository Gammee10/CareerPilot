# ADR-018: Use Hardened Passwordless Access-Link Security

## Status

Accepted — 2026-08-23

## Context

ADR-003 establishes invite-only passwordless email access, and ADR-009 assigns passwordless-link lifecycle ownership to the dedicated authentication and invitation capability. Access links are bearer credentials: a person or system that controls a valid link could redeem it. The private beta needs protection against guessing, replay, automatic email-security scanning, account enumeration, and excessive issuance without introducing a second authentication factor.

## Decision

Use a hardened passwordless-link policy:

- Invitation and sign-in links use opaque, unguessable values.
- Links have a short validity period and may be redeemed only once.
- Opening a valid link presents a confirmation step before redemption; merely opening the link must not authenticate a session or consume it.
- Invalid, expired, used, or otherwise unacceptable links fail with non-disclosing responses that do not reveal account, invitation, or user-data information.
- Link issuance is subject to abuse controls, including rate limits, and material lifecycle events are audit-recorded.
- Issuing a new sign-in link for an account invalidates that account's prior unused sign-in link. Invitation lifecycle remains separate from this sign-in-link rule.

Email-inbox control remains the MVP possession factor. This decision does not introduce a second factor or select token format, expiry duration, rate-limit values, identity or email provider, session mechanism, confirmation-interface design, or implementation technology.

## Alternatives Considered

### A. Basic links that authenticate immediately on click

This minimizes friction but may let email-security scanners consume a link or create a session, and provides weaker redemption control.

### B. Hardened, confirm-to-redeem passwordless links

Use short-lived, one-time, opaque links with an explicit confirmation before redemption, non-disclosing failure behavior, abuse controls, and auditing. This is the selected option.

### C. Passwordless links plus a second factor at every sign-in

This provides stronger protection from link forwarding and inbox compromise, but adds friction and support burden beyond the accepted MVP access model.

## Why We Chose This

The selected approach materially improves the security of email-link access while preserving the private beta's passwordless, low-friction onboarding. It also avoids treating routine email scanning as a user-authentication event.

## Consequences

### Positive

- Replay and accidental consumption risks are reduced.
- Invalid-link handling does not disclose account or invitation state.
- Link issuance and redemption can be investigated through audit records.

### Negative

- Users perform a confirmation action after opening a link.
- Email inbox compromise or deliberate link forwarding remains a residual risk without a second factor.
- The authentication capability must handle link invalidation and concurrent requests consistently.

### Risks

- An overly short lifetime may create sign-in friction, while an overly long lifetime increases exposure.
- Poorly designed confirmation can still be triggered by sophisticated automated scanners.
- Rate limits that are too strict can prevent legitimate access; limits that are too loose enable abuse.

## Revisit Conditions

Reconsider if the beta sees account-access abuse, requires stronger identity assurance, expands to public registration, or introduces an appropriate additional authentication factor.
