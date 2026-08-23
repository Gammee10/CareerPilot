# ADR-033: Require an Approval Gate for External Processors

## Status

Accepted — 2026-08-23

## Context

ADR-022 permits external processing only for an approved purpose with minimum necessary input, but no external provider has been selected. Providers for resume extraction, AI-assisted analysis, transactional delivery, or authorized source data can introduce privacy, source-compliance, retention, subprocessors, and incident-response obligations. The project requires the user to remain the final decision maker for architectural decisions and technology selection.

## Decision

Before an external processor receives user or source data, perform a documented review and obtain explicit decision-maker approval. The review covers:

- approved purpose and minimum necessary data categories;
- applicable source restrictions;
- prohibition on training or unrelated data reuse;
- retention and deletion behavior;
- security commitments;
- subprocessors;
- incident obligations; and
- termination and offboarding behavior.

Repeat the gate before materially expanding an existing processor's data scope or purpose.

This ADR selects no provider, authorizes no data transfer by itself, and does not select contractual mechanisms or implementation technology.

## Alternatives Considered

### A. Allow implementation to select providers as needed

This accelerates delivery but delegates a sensitive data-governance decision without a documented review or decision-maker approval.

### B. Require documented decision-maker approval before processor onboarding or scope expansion

Establish explicit approval criteria and preserve human authority over external data exposure. This is the selected option.

### C. Prohibit all external processing permanently

This is the strongest external boundary but can prevent the approved AI-assisted and extraction capabilities unless built entirely in-house.

## Why We Chose This

The selected gate makes external processing an explicit, reviewable architectural decision rather than an incidental implementation dependency. It preserves the MVP's flexibility while enforcing the approved purpose, minimization, and source-restriction boundaries.

## Consequences

### Positive

- External data exposure has documented purpose and approval.
- Provider scope expansion cannot silently occur through implementation changes.
- Offboarding and incident obligations are considered before onboarding.

### Negative

- Provider selection and material scope expansion require deliberate review.
- Implementation cannot independently add a processor to meet a delivery convenience.

### Risks

- An incomplete review could overlook a material provider obligation.
- A provider could change its practices after approval and require re-evaluation.
- Approval delay could affect roadmap timing.

## Revisit Conditions

Reconsider if the product scope, regulatory environment, source contracts, or provider landscape requires additional review criteria or a more formal vendor-governance process.
