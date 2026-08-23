# ADR-060: ADR-033 Onboarding Reviews — OCI Region/Services and Gemini Scope/Terms

## Status

Accepted — 2026-08-23

## Context

ADR-053 requires the approved OCI processing region and services to be recorded through ADR-033's external-processor review before user onboarding, and ADR-054 requires Gemini's unpaid-tier processing to pass the same gate with its residual data-use/human-review risk explicitly disclosed and accepted. The security/privacy release-validation gate (ADR-030) cannot pass until both reviews are completed. These reviews execute those obligations; they do not expand any accepted boundary.

## Decision

### Part A — Oracle Cloud Infrastructure review record

- **Provider and role:** Oracle Cloud Infrastructure is the approved private-beta hosting processor under ADR-053.
- **Approved processing region:** US East (Ashburn). The tenancy home region is permanent; it was selected for reliable Always Free Arm capacity. No country-specific data-residency promise exists; this posture is disclosed to users before sensitive content is provided under the accepted transparency decisions.
- **Services in scope:** Compute (one Always Free Arm VM), Object Storage (artifact bucket per ADR-050, dedicated backup bucket per ADR-057 with lifecycle-based 90-day expiry), Vault (production secrets per ADR-056), and supporting networking within the same tenancy (VCN, public subnet, Caddy ingress).
- **Recorded residual risks:** Always Free idle-instance reclamation; Arm capacity shortage; usage exceeding free limits. Any of these triggers an explicit hosting review — silent paid usage is prohibited.
- **Data categories processed:** all MVP data accepted by the architecture (accounts, profiles, resumes via Object Storage, evaluations, source records, audit metadata) within the selected region.

### Part B — Gemini unpaid-tier scope and terms review record

- **Processor and role:** Google Gemini API unpaid tier as the external AI processor for the internal FastAPI capability, per ADR-054.
- **Approved tasks:** resume extraction and job interpretation/matching only, executed through Node-constructed minimized task inputs.
- **Approved data categories:** purpose-scoped minimized candidate or job text. Excluded: the full identifier list in ADR-054 (user IDs, names, emails, phone numbers, account identifiers, authentication data, resume filenames, profile URLs, other unnecessary metadata); raw resume files where minimized structured input suffices; grounding, file upload, tuning, or any other feature that expands provider data use.
- **Terms acknowledgment:** Google's API terms for unpaid-tier usage permit provider use of submitted content and responses, including possible human review, for service improvement. CareerPilot keeps all identity/evaluation mapping internally; submitted content is minimized but not anonymous. This residual risk remains explicitly disclosed to users and accepted by the decision maker solely for this constrained private beta.
- **Re-review triggers:** any material change to Gemini's unpaid-tier data-use terms, approved task scope, or data categories halts content submission pending a new review and explicit decision-maker approval.
- **Operational note:** unpaid-tier rate limits constrain evaluation throughput; rate-limit responses are treated as transient under ADR-044's bounded retry rules within discovery scheduling.

## Alternatives Considered

### Region: US East (Ashburn) vs. EU region vs. other US regions

EU processing would carry stronger residency optics but no residency promise is made either way, and Ashburn has the most established Always Free Arm capacity history. Selected: US East (Ashburn).

### Gemini: confirm recorded scope vs. halt external AI processing

Halting would remove AI-assisted extraction/matching and degrade the MVP's core behavior without a substitute. Confirming the already-accepted minimized scope adds no new exposure. Selected: confirm.

## Why We Chose This

Both reviews complete the mandatory pre-onboarding gates without expanding any accepted boundary, cost, or data category. They convert prior conditional approvals into recorded, verifiable processor authorizations.

## Consequences

### Positive

- The ADR-033 preconditions for onboarding and the ADR-030 release gate are satisfiable.
- Processing locations and AI-processing terms are explicitly recorded and disclosable to users.
- Re-review triggers are unambiguous and auditable.

### Negative

- The permanent home-region choice forecloses later region relocation without a new tenancy or hosting review.
- Gemini's terms can change unilaterally; continued operation depends on monitoring for re-review triggers.

### Risks

- Terms drift between this review and implementation start; current terms text must be verified at implementation time, with deviations filed as re-review triggers rather than silently absorbed.
- Capacity or policy changes at Oracle may still force a hosting revisit despite region selection.

## Revisit Conditions

Revisit on any Gemini unpaid-tier terms/scope/data-category change, any material expansion of OCI services or region usage, Always Free limit pressure, or before public launch when paid and managed postures are evaluated.
