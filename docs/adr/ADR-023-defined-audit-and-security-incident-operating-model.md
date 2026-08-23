# ADR-023: Use a Defined Audit and Security-Incident Operating Model

## Status

Accepted — 2026-08-23

## Context

ADR-015 requires structured telemetry, distinct audit events, and sensitive-data minimization. ADR-016 through ADR-022 establish least-privilege access, exceptional-access controls, link-security events, retention schedules, and purpose-scoped data access. These controls need an operating model that creates accountable records, enables containment and investigation, and gives affected users meaningful notice when unauthorized sensitive-data access is confirmed.

## Decision

Maintain material audit events for authentication, invitation, authorization, exceptional access, user-data lifecycle, source-policy, and user-impacting actions. Each event records the actor or responsible capability, action, outcome, target category or identifier, authorization or declared purpose where relevant, timestamp, and correlation identifier, without raw sensitive content by default.

For a suspected security or isolation incident, operations shall:

1. Record and classify the incident.
2. Contain active risk.
3. Preserve only minimum necessary evidence under a scoped hold.
4. Assess affected users, data categories, scope, and cause.
5. Remediate and recover.
6. Complete a documented review.

Containment may include revoking access, disabling a source, or suspending administrator authority where justified.

For confirmed unauthorized access to or disclosure of sensitive user data, notify affected users without undue delay after sufficient information exists to provide meaningful notice, unless a documented legal or security reason requires delay.

This ADR does not establish a full enterprise compliance program, 24-hour operations commitment, specific incident-response time limits, or implementation tooling.

## Alternatives Considered

### A. Informal logging and ad hoc investigation

Keep general logs and decide how to investigate each incident when it occurs. This has low process overhead but weak accountability and inconsistent handling.

### B. Defined audit events and lightweight incident lifecycle

Use material audit records and a repeatable lifecycle for containment, investigation, recovery, review, and affected-user notification. This is the selected option.

### C. Full enterprise compliance and incident-management program

Adopt formal enterprise governance and response operations immediately. This may be appropriate later, but is disproportionate to the current private-beta scope.

## Why We Chose This

The selected model makes the approved controls operationally meaningful without imposing an unsupported enterprise program. It protects users from silent handling of confirmed unauthorized sensitive-data access while allowing justified, documented delay when immediate notice would undermine security or legal obligations.

## Consequences

### Positive

- Security and isolation investigations have a consistent, reviewable process.
- Audit records provide accountable evidence without duplicating sensitive payloads.
- Affected users have a defined notification expectation for confirmed unauthorized access or disclosure.

### Negative

- Operations must maintain incident records and perform documented reviews.
- Material-event definitions and notification judgment require ongoing discipline.

### Risks

- Overly broad audit capture could violate ADR-015 minimization.
- Poor incident classification could delay containment or notification.
- A vague exception for notice delay could undermine user trust if not documented and reviewed.

## Revisit Conditions

Reconsider if regulatory obligations, user scale, incident frequency, or team capacity require formal response timelines, external reporting, or a more comprehensive compliance program.
