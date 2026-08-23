# ADR-034: Allow Approved Cross-Border Processing Without an MVP Residency Promise

## Status

Accepted — 2026-08-23

## Context

The initial MVP targets Ethiopia-based users seeking US-market remote roles. Authorized sources and future external processors may operate across jurisdictions, but no provider or hosting arrangement has been selected and the product has made no data-residency commitment. ADR-033 requires processor approval before data transfer. The project needs a clear posture that avoids both hidden cross-border processing and premature geographic lock-in.

## Decision

- The MVP makes no country-specific data-residency promise.
- Cross-border processing is permitted only through approved processors and approved processing arrangements.
- Processing locations are documented as part of the external-processor approval gate.
- The product discloses this posture to users before they provide sensitive content.
- Applicable obligations must be validated before onboarding users or processors.

This ADR is a product and data-governance posture, not legal advice or a determination of applicable law. It does not select hosting regions, providers, or contractual mechanisms.

## Alternatives Considered

### A. No explicit cross-border policy

Allow processing wherever implementation or providers operate without an explicit user-facing posture. This maximizes flexibility but is opaque and weakens governance review.

### B. Approved cross-border processing with transparency and no MVP residency promise

Allow cross-border processing only through reviewed arrangements, document processing locations, and disclose the posture before sensitive content is provided. This is the selected option.

### C. Single-country or single-region residency mandate

Require all user data to remain in one chosen country or region. This provides stronger residency control but prematurely constrains future provider and hosting choices.

## Why We Chose This

The selected approach gives the private beta practical flexibility while preventing undisclosed or unreviewed cross-border data exposure. It preserves the option to adopt a residency commitment later if product, user, or legal evidence justifies it.

## Consequences

### Positive

- Processing geography becomes visible in provider governance.
- Users receive transparency before providing sensitive content.
- No premature hosting or provider-region decision is forced.

### Negative

- Processor onboarding requires location documentation and disclosure maintenance.
- Some users may prefer a residency commitment the MVP does not make.

### Risks

- Applicable obligations may require more restrictive handling than this general posture.
- Provider location changes could require renewed review or disclosure updates.
- Incomplete disclosure could undermine informed user expectations.

## Revisit Conditions

Reconsider if legal obligations, user requirements, enterprise sales, selected-provider capabilities, or supported markets require a specific data-residency commitment.
