# ADR-029: Treat External and User Content as Untrusted Evidence

## Status

Accepted — 2026-08-23

## Context

The MVP collects job listings and may accept imported URLs, processes user-provided resumes, and uses AI-assisted extraction and matching. Such text can be incomplete, misleading, or intentionally crafted to manipulate an AI system. ADR-002 requires deterministic policy alongside AI interpretation, and the MVP explicitly excludes autonomous application submission. The architecture needs to prevent input content and AI output from becoming a control plane.

## Decision

- Treat source listings, imported job URLs, resumes, and extracted text as untrusted evidence, not executable instructions.
- Do not allow such content to alter authorization, access scope, source policy, retention, workflow routing, hard constraints, or external actions.
- Permit only system-defined policies and commands to control those behaviors.
- Treat AI-assisted output as an untrusted proposed interpretation, constrain it to the requested task, validate it against expected structure, and combine it with deterministic policy before persistence or presentation.
- Prohibit AI output from independently creating invitations, changing profiles, triggering broader data access, bypassing source limits, or submitting an application.
- Preserve the evidence and uncertainty requirements of ADR-002 and ADR-013; do not present unsupported AI claims as confirmed facts.

This ADR does not select an AI provider, model, prompt format, validation library, or implementation technology.

## Alternatives Considered

### A. Treat retrieved and user-supplied text as trusted AI context

This simplifies prompt construction but allows hostile text to influence workflow control or sensitive-data handling.

### B. Treat all external and user-supplied content as untrusted evidence

Separate evidence from system instructions and require validation and deterministic control over security-sensitive behavior. This is the selected option.

### C. Avoid AI processing of resume and job content

This avoids prompt-injection exposure but conflicts with the approved resume-extraction and hybrid-matching direction.

## Why We Chose This

The selected boundary lets the MVP use AI for interpretation without giving external text or model output authority over access, retention, or workflow execution. It supports explainability by requiring AI claims to remain evidence-linked and uncertain when unsupported.

## Consequences

### Positive

- Untrusted content cannot directly become an authorization or workflow instruction.
- AI use remains subordinate to deterministic product policy.
- Evidence and uncertainty stay visible to users and operators.

### Negative

- AI interaction contracts and outputs require explicit validation.
- Some seemingly useful autonomous behavior remains intentionally unavailable.

### Risks

- Poor separation of instructions and evidence could still allow prompt-injection influence.
- Overly restrictive output constraints may reduce interpretation quality.
- Validation bugs could permit malformed or unsupported output to persist.

## Revisit Conditions

Reconsider if later capabilities require controlled AI tool use, autonomous actions, materially different external-content processing, or new evaluation evidence demonstrates that the boundary needs adjustment.
