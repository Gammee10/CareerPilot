# ADR-054: Use Gemini Unpaid API Behind an Explicit AI Data-Minimization Boundary

## Status

Accepted — 2026-08-23

## Context

The private beta requires AI-assisted resume extraction and job interpretation, but reliable local inference is not feasible and the current hosting policy is $0. Gemini's unpaid API quota meets the cost constraint, but Google states that it may use submitted content and responses to improve and develop products and that human reviewers may process them. This conflicts with the stronger private-processing posture preferred by ADR-022, so the exception must be explicit, minimized, and transparent.

## Decision

- Approve Gemini API's unpaid tier only for the internal FastAPI capability's approved resume-extraction and job-interpretation/matching tasks during the $0 private beta.
- Before every provider call, the Node-owned background-work path shall construct a task-specific minimized payload and redact those items if embedded in otherwise relevant source text. It shall never send user IDs, names, email addresses, phone numbers, account identifiers, authentication data, resume filenames, direct profile URLs, or other unnecessary identifying metadata.
- Send only the candidate or job information needed for the individual task. Do not send raw resumes or files when the needed task input can be represented by minimized text or structured candidate information.
- Keep the mapping between provider requests or outputs and CareerPilot accounts, profiles, evaluations, and internal identifiers entirely within CareerPilot. Provider-visible payloads and provider-facing logs shall not contain that mapping.
- FastAPI remains non-public and non-authoritative under ADR-047. Gemini output is an untrusted structured proposal, validated and combined with deterministic policy by the Node-owned path before any authoritative result is persisted.
- Do not use Gemini grounding, file upload, tuning, or other optional features that widen provider data use without a new ADR-033 review and approval.
- Disclose this unpaid-tier processing and its residual data-use risk clearly to beta users before their data is sent.

Data minimization reduces unnecessary exposure; it does not anonymize all content, guarantee that prompts are non-personal, or make Gemini's unpaid tier equivalent to a private or paid AI service. The approved exception is limited to the stated private-beta scope and is subject to the provider's then-current terms, availability, quotas, and supported-region restrictions.

## Alternatives Considered

### A. Gemini unpaid API with explicit minimization and disclosure

Meets the current $0 and reliability constraints, while accepting that minimized content remains subject to Gemini's unpaid-tier data-use policy. This is the selected option.

### B. Self-hosted local inference

Avoids the external AI processor but is not reliable enough on the available private-beta infrastructure.

### C. Gemini paid tier or another approved private AI service

Can offer a materially stronger provider data-use posture but violates the current $0 constraint.

## Why We Chose This

The decision keeps the beta operational while making both the data boundary and the residual provider exposure explicit. It does not conceal a cost-driven privacy trade-off behind the word “anonymized.”

## Consequences

### Positive

- AI-assisted MVP tasks can run without planned AI spend.
- The provider receives less identifying and unnecessary data.
- CareerPilot retains authoritative user identity and evaluation linkage internally.

### Negative

- Minimized candidate and job content still leaves the CareerPilot boundary and may contain information that is personal or sensitive in context.
- Unpaid-tier data use, human review, quota, and availability constraints remain.
- The product must provide clear, meaningful disclosure before use.

### Risks

- An implementation change could accidentally add identifiers or excess context to an AI request.
- A provider terms, region, or quota change could make the beta unsuitable or unavailable.
- Users may reasonably prefer not to have even minimized content sent to an unpaid AI service.

## Revisit Conditions

Reconsider before public launch, on any material Gemini terms or data-use change, if the $0 constraint changes, if the approved task scope expands, or if local inference or a paid private-processing option becomes reliable and affordable.
