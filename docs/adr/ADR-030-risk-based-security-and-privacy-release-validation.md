# ADR-030: Use Risk-Based Security and Privacy Release Validation

## Status

Accepted — 2026-08-23

## Context

The accepted MVP architecture has detailed access, retention, audit, credential, and AI-processing policies. An invite-only private beta still handles sensitive career data and must provide credible account isolation. Without a defined validation expectation, security-sensitive changes could be released with ordinary feature testing that does not exercise the approved controls.

## Decision

Before initial private-beta onboarding, perform a focused architecture and security review. For any material change to authentication, authorization, sensitive-data processing, external processors, source policy, or retention, repeat the relevant risk-based validation before release.

Validation must provide evidence that relevant changes preserve:

- unauthenticated denial, user-to-user isolation, and administrator least privilege;
- invitation, link, session, suspension, and revocation behavior;
- exceptional-access authorization and auditability;
- retention, deletion, recovery-copy, and preservation-hold behavior;
- telemetry and audit minimization and absence of secrets from routine diagnostics;
- source-policy and external-processor data-use restrictions; and
- resistance to adversarial untrusted-content attempts to influence AI interpretation or workflow behavior.

This ADR does not select testing frameworks, security vendors, external-audit providers, or implementation tooling.

## Alternatives Considered

### A. Ordinary feature testing only

Rely on normal product testing and investigate security issues after release. This is fast but insufficient for isolated user accounts and sensitive data.

### B. Risk-based security and privacy validation gate

Review the initial beta and repeat relevant checks for material security-sensitive changes. This is the selected option.

### C. External penetration test and formal compliance audit before every release

Provide greater formal assurance but impose disproportionate cost and process for the private beta.

## Why We Chose This

The selected gate makes the accepted security and governance decisions verifiable without requiring an enterprise compliance program. It focuses effort where a change can materially affect user isolation, sensitive data, or trusted workflow behavior.

## Consequences

### Positive

- Security-critical behavior has explicit release evidence.
- The beta has an accountable readiness check before onboarding users.
- Material changes cannot silently bypass relevant validation.

### Negative

- Security-sensitive changes require additional review and evidence.
- The team must maintain a usable mapping from changes to required checks.

### Risks

- A weak definition of material change could let risky changes bypass validation.
- Checklists alone can create false confidence if evidence is superficial.
- Without ownership, review findings may not be resolved before release.

## Revisit Conditions

Reconsider if user scale, legal obligations, incident experience, or product risk warrants external assessment, formal release criteria, or a broader compliance program.
