# ADR-035: Use Layered User Data-Use Transparency and Acknowledgement

## Status

Accepted — 2026-08-23

## Context

The MVP processes sensitive career data, performs discovery and matching from user-approved profile information, permits controlled exceptional administrator access, and may use approved cross-border external processing. ADR-034 requires disclosure before sensitive content is provided. A single notice outside the user journey risks leaving users unaware of material processing at the time they choose to upload a resume or use a newly introduced processor-backed feature.

## Decision

Provide layered, plain-language data-use disclosure:

- during account activation; and
- contextually before resume upload or a newly introduced external-processing purpose.

Require user acknowledgement of a material disclosure change before use of the affected feature. Explain processed career and job data and their purposes; that user-approved profile data drives discovery and matching; retention and deletion posture and how to request closure or deletion; approved cross-border and external-processing posture where applicable; the no-routine-administrator-access rule and tightly controlled exceptional-access policy; and support or concern-reporting routes.

A user who declines resume upload remains able to complete a profile manually.

This ADR is a transparency and acknowledgement decision, not legal advice or a selection of consent-management technology.

## Alternatives Considered

### A. One general notice outside the product journey

Provide a single broad notice. This has low friction but can fail to inform users when they provide sensitive content or encounter a new processing purpose.

### B. Layered disclosure with acknowledgement of material changes

Provide activation and contextual disclosure, and require acknowledgement before an affected feature is used after a material change. This is the selected option.

### C. Separate legal-style consent for every ordinary action

Require consent for each profile edit, matching run, and dashboard view. This creates excessive friction and weak practical comprehension.

## Why We Chose This

The selected approach gives users relevant information at the meaningful decision points without turning ordinary product use into a series of repetitive legal prompts. It also preserves the manual-profile path for users who do not wish to upload a resume.

## Consequences

### Positive

- Users receive timely, comprehensible information about sensitive-data use.
- Material processing changes cannot be silently introduced to an affected feature.
- Resume upload remains optional for profile completion.

### Negative

- User-facing disclosure content and change classification must be maintained.
- An affected feature may be temporarily unavailable until acknowledgement occurs.

### Risks

- Vague disclosure or poor change classification can undermine transparency.
- Overly frequent acknowledgements can create notice fatigue.
- Applicable legal requirements may demand additional disclosures or a different legal basis.

## Revisit Conditions

Reconsider if legal obligations, new processing purposes, user feedback, or product scope require different notice, acknowledgement, or consent behavior.
