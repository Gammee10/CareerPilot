# MVP User Flows — Autonomous Job Search & Application Agent

## Status

Accepted MVP-flow specification. Flows reflect approved requirements and architecture decisions; implementation technology is selected (ADR-047 through ADR-059).

## Flow 1: Invite-Only Access

**Goal:** A private-beta user receives an individual account without public sign-up.

1. An authorized administrator invites a tester.
2. The tester creates or activates their individual account.
3. The tester receives plain-language data-use disclosure and acknowledges it before using affected features.
4. The tester signs in and can access only their own profile and results.

The invitation and subsequent sign-in use passwordless email links. Public self-registration is disabled.

**Failure expectations:**

- Public visitors cannot self-register.
- An invalid, expired, or already-used invitation communicates the problem without disclosing another user's identity or data.
- A user cannot access another user's profile or job results.
- A material data-use disclosure change is acknowledged before the affected feature is used.

## Flow 2: Profile Setup and Resume Review

**Goal:** Establish an accurate, user-approved basis for discovery and matching.

1. A signed-in user uploads a resume.
2. The system derives a profile draft from the resume.
3. The user reviews and edits the extracted fields.
4. The user completes required eligibility settings, including residence and authorized-work locations.
5. The user configures target roles, preferences, and hard constraints.
6. The user saves the profile; the approved editable fields become authoritative.

**Failure and edge expectations:**

- If extraction fails or data is incomplete, the user can complete the profile manually.
- The system identifies extracted or inferred data so it is not mistaken for a user-confirmed claim.
- A profile missing required settings is clearly marked incomplete and cannot be used as if it supported reliable eligibility filtering.

## Flow 3: Scheduled Daily Discovery

**Goal:** Produce a fresh daily set of relevant jobs for an active user.

1. At the user's configured local schedule, the system derives searches from the approved profile and enabled search terms.
2. The system collects jobs from authorized sources.
3. The system normalizes and deduplicates jobs.
4. The system evaluates clear hard-constraint conflicts.
5. The system analyzes remaining jobs, calculates explainable matches, and ranks results.
6. The dashboard shows the completed run time and newly available results.

**Failure and edge expectations:**

- A source failure does not prevent processing usable results from other sources.
- Results identify incomplete or limited runs rather than presenting them as complete success.
- Source rate limits defer or limit collection without bypassing source controls.
- Jobs with explicit eligibility conflicts are excluded; unclear eligibility is retained, marked, and penalized.

## Flow 4: Daily Job Review

**Goal:** Let a user rapidly identify worthwhile jobs.

1. The user opens the dashboard.
2. The default view presents new, currently believed-active jobs in ranked order.
3. For each job, the user can see concise match reasons, dimension scores, eligibility state, source, and direct application link.
4. The user opens a job-detail view when they need supporting evidence, extracted facts, gaps, uncertainty, and full score detail.
5. The user may save a job or mark it not interested.
6. The user follows the external application link to apply outside the product.

**Failure and edge expectations:**

- A job marked not interested does not reappear as new.
- A closed or removed job is not ranked as active; saved/history entries show its unavailable state.
- Changed previously seen jobs are explicitly identified and may be re-surfaced.
- Missing salary or unverified remote eligibility is visible; it is not treated as confirmation.

## Flow 5: Manual Refresh

**Goal:** Let a user request newer results without violating source constraints.

1. The user requests a refresh from the dashboard.
2. The system accepts, queues, defers, or rejects the request based on rate limits and current activity.
3. The dashboard indicates the request state.
4. When processing completes, the dashboard shows the latest completed discovery time and results or a limited/failure state.

**Failure expectations:**

- A manual request does not bypass source rate limits or cause duplicate concurrent runs.
- A partial refresh clearly indicates the affected sources or limitations where practical.

## Flow 6: Profile or Search-Strategy Update

**Goal:** Let a user change what the system searches and how it evaluates jobs.

1. The user edits profile settings, hard constraints, priorities, or generated search terms.
2. The user reviews and saves the change.
3. The system immediately uses the updated configuration for future discovery and queues asynchronous re-evaluation of the user's active, non-dismissed jobs.
4. The dashboard indicates when re-evaluation is pending or in progress.

## Flow 7: Account Closure and Deletion

**Goal:** Let a user end their account and request deletion without relying on routine administrator access to their content.

1. The signed-in user requests account closure from the dashboard.
2. The system explains the effect on access, background work, and deletion.
3. The user confirms through a newly redeemed passwordless link for that account.
4. The system blocks access and user-specific background work immediately and begins the approved deletion lifecycle.
5. The dashboard provides truthful deletion-status information until access ends.

**Failure and edge expectations:**

- A stale or hijacked session cannot confirm closure without fresh passwordless confirmation.
- Closure cannot be cancelled through self-service after confirmation.
- A preservation hold may retain only its scoped data under ADR-024; it does not restore user access or cancel the closure process.
