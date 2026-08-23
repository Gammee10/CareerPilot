# ADR-052: Use Resend for Restricted Transactional Email Delivery

## Status

Accepted — 2026-08-23; Amended 2026-08-23 (ADR-058) to permit administrator-facing essential operational alert emails within the same data restrictions.

## Context

The custom passwordless identity capability requires reliable transactional delivery for invitations, access links, and fresh deletion confirmation. Email delivery is external processing because the provider receives recipient and message data. ADR-033 requires an explicit, purpose-scoped approval before such processing.

## Decision

- Approve Resend as the transactional-email processor only for invitation, sign-in, fresh deletion-confirmation, and essential account-lifecycle email delivery.
- Limit data sent to the recipient email address, minimum message metadata and content, and opaque passwordless URL needed for delivery.
- Do not send resumes, profiles, job data, evaluations, or detailed audit content.
- Disable open and click tracking.
- Receive delivery, bounce, and failure events through authenticated webhooks for operational status.
- Restrict Resend credentials to the authentication and transactional-email delivery capability.
- Require a new ADR-033 review and approval before materially expanding Resend's data scope or purpose.

This ADR does not select email-template implementation, DNS provider, webhook implementation, or deployment product.

## Amended Scope — Essential Operational Alerts (ADR-058)

Resend may additionally deliver essential administrator-facing operational alert emails (missed/failed daily backup, repeated container restarts, disk-usage threshold, restore-drill due or failed) per ADR-058. This expansion is limited to the administrator recipient address and minimum message content; it grants no access to resumes, profiles, job data, evaluations, or detailed audit content, and tracking remains disabled. Any further expansion still requires a new ADR-033 review and approval.

## Alternatives Considered

### A. Resend with restricted transactional scope

Use Resend's transactional API and delivery-status webhooks while minimizing message content. This is the selected option.

### B. Postmark or an equivalent transactional provider

Provides a similar specialized service, but was not selected for the MVP.

### C. Amazon SES

Could consolidate email delivery with a future AWS hosting decision, but would prematurely couple the two choices.

## Why We Chose This

Resend provides focused transactional delivery and delivery-status events without making it the identity authority. The narrow data scope and disabled engagement tracking satisfy the approved data-minimization and purpose-limitation posture.

## Consequences

### Positive

- Authentication delivery is independent of the custom identity lifecycle.
- Delivery, bounce, and failure information supports truthful operational handling.
- Sensitive product content remains outside the email provider's scope.

### Negative

- Passwordless URLs necessarily appear in the delivered message content.
- Email delivery remains an external service dependency.

### Risks

- Provider availability or deliverability failures can delay authentication.
- A future change that adds unnecessary content or tracking could exceed the approved scope.

## Revisit Conditions

Reconsider if Resend's delivery, security, pricing, terms, or processing posture becomes unsuitable, or a future hosting decision justifies a reviewed provider consolidation.
