# ADR-016: Use Least-Privilege Authorization and Controlled Administrator Access

## Status

Accepted — 2026-08-23

## Context

The MVP is an invite-only private beta with isolated individual accounts. It stores sensitive career data, including resumes, career profiles, eligibility information, personalized evaluations, and job-review history. ADR-009 establishes a dedicated authentication and invitation capability, ADR-014 requires a user-scoped dashboard boundary, and ADR-015 requires distinct audit events and sensitive-data minimization.

Authentication alone does not determine whether an authenticated user or administrator may access a particular resource. The architecture needs an explicit authorization policy that protects individual-account isolation while allowing the beta to be operated and investigated responsibly.

## Decision

Use deny-by-default, resource-level authorization.

- An individual user may access and modify only their own account-scoped profile, resume, search strategy, discovery status, evaluations, and review state.
- Shared job and source data may be exposed only through the user's permitted dashboard context; the MVP provides no general shared-data browsing capability.
- Administrator authority is least-privilege and limited to invitation issuance and revocation, account access-state management, authorized source and processing operations, and security or operational audit inspection.
- Administrator authority does not provide routine access to resume contents, career-profile contents, detailed evaluations, or user job-review history.
- Exceptional access to user content may occur only for a defined support, security, or legal incident. It must be purpose-limited, time-bounded, attributable to a named administrator, and audit-recorded.

Subsequent ADRs define exceptional-access approval, user notice, and record-retention policy. Exact content scope remains bounded by the defined incident purpose.

## Alternatives Considered

### A. Broad administrator access

Allow administrators to routinely view and modify all user data. This is simple to operate but creates disproportionate internal-access risk and weakens the isolated-account promise.

### B. Least-privilege administration with controlled exceptional access

Allow defined operational administration while prohibiting routine access to sensitive user content. Permit accountable exceptional access for defined incidents. This is the selected option.

### C. No administrator access to user content

Prohibit administrator inspection of user content in all circumstances. This maximizes privacy but materially limits support, security response, and incident investigation.

## Why We Chose This

The selected policy preserves the MVP's private-account isolation while retaining a narrowly controlled ability to operate the service and investigate legitimate incidents. It avoids treating broad internal access as a default operating convenience.

## Consequences

### Positive

- User data access has an explicit ownership and least-privilege policy.
- Routine administration does not require exposure of sensitive career information.
- Exceptional access is attributable and available for audit and investigation.

### Negative

- Operational and support workflows must work with limited routine visibility into user content.
- Exceptional-access controls require explicit policy and operational design.

### Risks

- Incomplete resource-level checks outside the authentication boundary could still violate isolation.
- Poorly defined exceptional-access procedures could become de facto broad access.
- Excessive restrictions could delay legitimate support or security response.

## Revisit Conditions

Reconsider if the product introduces organizations, delegated administration, enterprise identity, legal obligations requiring different administrator access, or evidence that the approved operational model cannot support the private beta safely.
