# ADR-026: Use Bounded Passwordless-Link Validity and Issuance Limits

## Status

Accepted — 2026-08-23

## Context

ADR-018 requires short-lived, one-time passwordless links with abuse controls, while ADR-025 establishes invitation lifecycle states. Concrete validity periods and issuance limits are necessary for consistent security behavior, user communication, operational monitoring, and tests.

## Decision

- A sign-in access link expires 15 minutes after issuance.
- An invitation expires 14 days after issuance unless accepted or revoked earlier.
- Sign-in-link requests for an invited email are limited to three requests per 15-minute interval and ten requests per 24-hour interval.
- Rate-limit responses remain non-disclosing.
- An expired invitation may be re-issued, and an administrator may revoke and re-issue an invitation at any time.

This decision does not change ADR-018 requirements for opaque links, one-time redemption, confirmation before redemption, non-disclosing invalid-link responses, or invalidation of a prior unused sign-in link when a new one is issued.

## Alternatives Considered

### A. Long-lived links with minimal throttling

Use 24-hour sign-in links, 30-day invitations, and minimal issuance limits. This improves convenience but increases bearer-link exposure and abuse opportunity.

### B. Fifteen-minute sign-in links, 14-day invitations, and moderate issuance limits

Use a 15-minute sign-in validity, 14-day invitation validity, and per-email request limits of three per 15 minutes and ten per 24 hours. This is the selected option.

### C. Very short links and strict quotas

Use five-minute sign-in links, seven-day invitations, and very restrictive limits. This minimizes exposure but risks unnecessary delivery and onboarding friction.

## Why We Chose This

The selected limits meaningfully constrain bearer-link exposure and repeated-request abuse while leaving sufficient time for normal email delivery and private-beta onboarding.

## Consequences

### Positive

- Access-link exposure has a defined short maximum duration.
- Invitations do not remain valid indefinitely.
- Repeated issuance is bounded and observable.

### Negative

- Users may need to request another link after a short delay.
- Administrators may need to re-issue invitations to unavailable invitees.

### Risks

- Email delivery delays may make 15 minutes inconvenient for some users.
- Per-email limits cannot alone prevent distributed abuse across many addresses.
- Limits that are too restrictive could impair legitimate support access.

## Revisit Conditions

Reconsider if delivery performance, support experience, access abuse, or user population changes show that the selected periods or limits are materially unsuitable.
