# MVP Requirements — Autonomous Job Search & Application Agent

## Status

Approved. All functional requirements FR-0 through FR-24 are accepted and binding for the MVP implementation.

## 1. Career Profile — Approved

### FR-0: Invite-only passwordless access

The MVP shall allow access only through invitations issued by authorized administration. Public self-registration shall not be available.

Invited users shall activate and access their individual accounts through passwordless email links. Invalid, expired, or used links shall fail safely without disclosing another user's information.

### FR-0a: Data-use transparency and acknowledgement

The system shall provide plain-language data-use disclosure during account activation and contextually before resume upload or a newly introduced external-processing purpose. It shall explain the processed career and job data and their purposes; retention and deletion posture; approved cross-border or external-processing posture where applicable; the limited exceptional-access policy; and how to request support or account closure/deletion.

The system shall require acknowledgement of a material disclosure change before the user uses the affected feature. A user who does not upload a resume shall remain able to complete their profile manually.

### FR-0b: Account closure and deletion request

The system shall allow an account owner to initiate account closure and deletion from the dashboard. It shall clearly explain the effects and require confirmation through a newly redeemed passwordless link for that account. Confirmation shall immediately block access and user-specific background work and begin the approved deletion lifecycle.

The system shall provide truthful deletion-status information. An administrator may close an account only for a documented user request, legal obligation, or security reason; each such action shall be audit-recorded.

### FR-1: Profile ownership and editing

The system shall provide each invited user with an editable career profile. A user's profile and derived results shall be accessible only to that user and authorized system administration.

### FR-2: Resume upload and review

The system shall allow a user to upload a resume and shall derive a reviewable profile draft from it. The user shall be able to review and edit the draft before saving it.

User-approved editable profile fields are authoritative over extracted resume data.

### FR-3: Structured profile settings

The profile shall support the following structured settings:

- desired roles or titles, with relative priority;
- skills and technologies, with relative priority and optional must-have marking;
- seniority or experience-level preference, optionally made strict by the user;
- residence country;
- countries or regions in which the user is authorized or able to work;
- target job markets or locations, optionally made strict by the user;
- work-mode preference, with remote-only available as a hard constraint;
- remote eligibility geography or time-zone preference;
- employment-type preference, optionally made strict by the user;
- optional minimum salary and currency;
- industry preferences; and
- excluded roles, industries, and companies.

### FR-4: Hard constraints and preferences

For each applicable setting, the system shall make clear whether it is operating as a hard constraint or a ranking preference. The user shall be able to change that classification where the setting supports both uses.

The system shall apply hard constraints deterministically and shall use preferences to influence ranking rather than silently exclude jobs.

### FR-5: Free-text preferences

The profile shall allow free-text preferences and deal breakers. When such input influences analysis or ranking, the resulting interpretation shall be visible to the user and shall not silently be treated as a deterministic rule.

### FR-6: Eligibility handling

The system shall reject a job only when a job's explicit residence, location, or work-authorization requirement clearly contradicts the user's residence or authorized-work-location profile.

The system shall retain jobs with unverified eligibility, clearly label the uncertainty, explain the evidence or missing evidence, and apply a transparent ranking penalty. It shall distinguish confirmed eligibility, unverified eligibility, and explicit ineligibility.

### FR-7: Salary handling

Where a user sets a minimum salary as a hard constraint, the system shall reject a job only when a disclosed salary is clearly below that minimum. A job with no disclosed salary shall remain visible and be marked as unknown.

## Deferred Profile Capabilities

The MVP does not require LinkedIn-profile import, personality assessments, detailed visa workflows, or management of multiple role-tailored resumes.

## 2. Discovery Scheduling — Approved

### FR-8: Daily per-user discovery

The system shall perform scheduled job discovery once per day for each active user, aligned to that user's configured time zone and intended morning availability.

### FR-9: Manual refresh

The system shall provide a manual refresh action. It shall be subject to source-specific rate limits and other operational safeguards; it shall not guarantee immediate retrieval from every source.

### FR-10: Freshness transparency

The dashboard shall show when the user's job discovery was last completed and whether a refresh is in progress, completed with limitations, or failed.

### FR-10a: Authorized source collection

The system shall collect job data only through source access authorized for the product's intended use. Individual source integrations shall be independently addable, modifiable, disableable, and replaceable.

### FR-10b: Job normalization

The system shall normalize collected jobs into a common job record that, where source data is available, captures title, company, location, work mode, salary, employment type, experience requirements, skills or technologies, responsibilities, qualifications, application URL, posting date, source, and source-specific identifiers.

### FR-10c: Deduplication

The system shall detect and consolidate duplicate listings discovered from the same or different sources while preserving relevant source and application-link information.

## 3. Search Strategy — Approved

### FR-11: Profile-derived searches

The system shall derive baseline source searches from the user's configured target roles and core preferences.

### FR-12: Related-role expansion

The system may generate related titles and search queries to broaden discovery beyond a user's literal target-role wording. This expansion shall remain transparent to the user.

### FR-13: User control of search strategy

The user shall be able to view, edit, and disable generated search terms or queries. The MVP shall not use an opaque or uncontrolled self-modifying search strategy.

## 4. Daily Job Review — Approved

### FR-14: New-jobs view

The dashboard shall show newly discovered eligible candidate jobs by default and provide access to previously discovered jobs.

### FR-15: User review actions

The user shall be able to mark a job as saved or not interested. A job marked not interested shall not be presented as new again.

### FR-16: Re-presentation of changed jobs

The system shall re-surface a previously seen job only when material job information changes, including its description, salary, location, application deadline, or eligibility signal. The dashboard shall indicate that the job changed and identify the material change where available.

### FR-17: Application tracking boundary

The MVP shall not provide formal application tracking, interview tracking, or outcome tracking. Users apply outside the product through the job's direct link.

### FR-17a: Listing lifecycle

The default new-jobs view shall show only jobs believed to be active. When a source indicates that a job is closed or removed, the system shall mark it unavailable and remove it from normal ranking.

Saved or historical unavailable jobs shall be retained and visibly labeled. The dashboard shall show when a listing was last observed active and shall represent stale or inconclusive availability as uncertainty rather than claiming that the job is open.

## 5. Matching and Explainable Scoring — Approved Direction

### FR-18: Hybrid evaluation model

The system shall apply deterministic hard constraints and use AI-assisted job interpretation and semantic matching for natural-language ambiguity. It shall not use a single opaque AI score as the sole basis for ranking.

### FR-19: Dimension scores

For each evaluated job, the system shall expose an overall match score and named dimension scores, including role match, skill match, experience match, work-mode or location eligibility, and salary match when salary information is available.

### FR-20: Explanation and uncertainty

The system shall explain the important strengths, gaps, exclusions, and uncertainties that affected a job's evaluation. An explanation shall distinguish explicit job evidence from missing or ambiguous information.

### FR-21: Ranking behavior

The system shall rank jobs using the hybrid evaluation result, user hard constraints and preferences, and transparent penalties such as unverified work eligibility. A hard-constraint failure shall not be overridden by an AI match score.

### FR-22: User scoring priorities

The system shall use calibrated default scoring weights. Users shall be able to express simple higher or lower priorities for applicable dimensions, such as role fit, salary, remote eligibility, and specific skills, without editing numeric dimension weights. Hard constraints shall remain non-negotiable.

### FR-23: Evidence-linked explanations

The system shall present concise match explanations and provide a detail view that connects important claims to identifiable job-description evidence or named structured job fields. It shall explicitly label information as inferred or uncertain where supporting evidence is unavailable or ambiguous.

The system shall not represent a qualification as explicitly required or present without identifiable source evidence.

### FR-24: Re-evaluation after profile changes

When a user changes profile settings, hard constraints, priorities, or enabled search terms, the system shall save the change immediately, use it for future discovery, and asynchronously re-evaluate that user's active, non-dismissed jobs. The dashboard shall indicate when re-evaluation is pending or in progress.
