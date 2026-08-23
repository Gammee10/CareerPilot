# ADR-022: Use Purpose-Scoped Sensitive-Data Access and External-Processing Controls

## Status

Accepted — 2026-08-23

## Context

The MVP processes resumes, career profiles, eligibility details, personalized evaluations, shared job information, and AI-assisted interpretation. ADR-016 and ADR-017 limit administrator access; ADR-014 limits dashboard access; and ADR-015 prohibits routine copying of sensitive content into telemetry and audit records. The architecture also allows future selection of external processors for approved resume-extraction or AI-assisted analysis functions.

## Decision

Use purpose-scoped, minimum-necessary sensitive-data access.

- Authentication and invitation access identity, invitation, and access-link records, not resume, profile, or evaluation content.
- Source adapters receive permitted search criteria, not raw resumes or unrelated user evaluation history.
- Resume processing may access the submitted resume and relevant draft or profile context only.
- Matching may access the approved profile fields and job evidence needed for the particular evaluation only.
- Dashboard queries return only the authenticated user's permitted view.
- An external processor used for an approved function may receive only the minimum necessary input. It must not use that input for unrelated processing or model training and must be subject to the applicable access, retention, and deletion obligations.

Administrator access remains governed by ADR-016 and ADR-017. Telemetry and audit content remains governed by ADR-015. This ADR does not select external processors, contractual mechanisms, encryption mechanisms, data-transfer protocols, or implementation technologies.

## Alternatives Considered

### A. Broad trusted-internal access

Allow internal capabilities to access shared user content whenever it appears useful. This simplifies integration but weakens isolation and makes unnecessary exposure likely.

### B. Purpose-scoped minimum-necessary access with external-processing restrictions

Give each capability only the content needed for its defined responsibility and constrain external processors to the approved purpose. This is the selected option.

### C. Never permit external processing of sensitive content

This provides the strongest external boundary but could rule out resume extraction and AI-assisted matching capabilities in the approved MVP scope.

## Why We Chose This

The selected policy preserves required MVP processing while preventing convenience-based expansion of sensitive-data access. It makes component boundaries meaningful in data-governance terms and keeps any external processing accountable to the same purpose and lifecycle rules.

## Consequences

### Positive

- Sensitive-data exposure follows explicit responsibility boundaries.
- Internal and external processing can be reviewed against clear input-purpose constraints.
- The architecture does not assume that every trusted system component may inspect all user data.

### Negative

- Capability contracts must identify required data precisely.
- Some diagnostics and feature ideas may require a separately approved access expansion.

### Risks

- Over-broad capability inputs could erode the policy in practice.
- An external processor's terms or behavior may be unsuitable for the required restrictions.
- Insufficient job or profile context could reduce processing quality and require deliberate adjustment.

## Revisit Conditions

Reconsider if approved capabilities require additional data, an external processor cannot meet the restrictions, or product scope introduces new user-consented processing purposes.
