# Autonomous Job Search & Application Agent — Project Handoff Summary

## 1. Project Vision

Build a **fully autonomous personal job-search and application agent**.

The long-term vision is:

> Give the agent a user's career profile once, and it continuously discovers relevant jobs, evaluates them, applies to suitable positions, monitors application-related emails, tracks application outcomes, and sends the user useful daily updates.

The system should eventually behave more like a **Personal Career Agent** than a simple job scraper or auto-apply bot.

The project will be built **incrementally**, with each phase producing a useful product. The MVP does NOT need to contain the entire autonomous system.

---

# 2. Core Long-Term Workflow

```text
                    USER PROFILE
                         │
                         ▼
                  JOB DISCOVERY
                         │
                         ▼
                  JOB UNDERSTANDING
                         │
                         ▼
                   JOB EVALUATION
                         │
                         ▼
                  MATCH / RANKING
                         │
                         ▼
                    APPLICATION
                         │
                         ▼
                    TRACKING
                         │
                         ▼
                  EMAIL MONITORING
                         │
                         ▼
                   DAILY DIGEST
                         │
                         ▼
                  FEEDBACK / LEARNING
                         │
                         └──────────► Better decisions
```

---

# 3. Major Capabilities

The eventual system should contain approximately these capabilities:

### A. User Career Profile

Store:

- Resume
- Skills
- Experience
- Education
- Desired roles
- Preferred locations
- Remote/hybrid/on-site preferences
- Salary expectations
- Job type
- Technologies
- Industries
- Other career preferences
- Hard constraints
- Soft preferences

---

### B. Job Discovery

Discover jobs from multiple sources, potentially including:

- LinkedIn
- Indeed
- Company career websites
- Greenhouse
- Lever
- Wellfound
- Other job boards/APIs/sources

The architecture should **not be tightly coupled to LinkedIn or Indeed**.

Use a source-adapter concept:

```text
JobSource
├── LinkedIn
├── Indeed
├── Greenhouse
├── Lever
├── Company Websites
└── Other Sources
```

All sources should eventually produce normalized job data.

---

### C. Job Understanding

For each job:

- Extract title
- Company
- Location
- Salary
- Employment type
- Experience requirements
- Skills
- Technologies
- Responsibilities
- Qualifications
- Application URL
- Posting date
- Source
- Other relevant information

LLMs can be used to interpret ambiguous/natural-language requirements.

---

### D. Job Matching / Scoring

Do not rely solely on one opaque AI score.

Ideally evaluate multiple dimensions:

```text
Skill Match
Experience Match
Location Match
Salary Match
Role Match
Education Match
Preference Match
Overall Score
```

Example:

```text
Skill Match:       92%
Experience Match:  85%
Location Match:   100%
Salary Match:      90%
Role Match:        95%
Education Match:   70%

Overall:            89%
```

The system should also explain **why** a job received its score.

Example:

```text
✓ Strong TypeScript/React match
✓ Strong backend match
✓ Remote position
✓ Salary within target

⚠ Requires 3+ years experience
⚠ AWS experience preferred
```

The system should be **auditable and explainable**, especially before autonomous applications are enabled.

---

# 4. Hard Constraints vs Soft Preferences

This is an important design principle.

### Hard constraints

Rules that should normally eliminate a job.

Examples:

```text
Must be remote
Salary >= X
Must accept applicants from user's location
Must be a certain type of role
Must not require prohibited conditions
```

### Soft preferences

Factors that influence ranking but don't automatically eliminate a job.

Examples:

```text
Prefer:
- Python
- TypeScript
- AI/ML
- Backend
- Startups
- Remote
```

The system should apply:

```text
Hard filtering
      ↓
Candidate jobs
      ↓
AI evaluation/ranking
      ↓
Best opportunities
```

---

# 5. Job Discovery Should Eventually Be Intelligent

The agent should not simply search one fixed query.

For example, if the user wants:

> AI Engineer

the system could discover related roles:

```text
AI Engineer
ML Engineer
Applied AI Engineer
LLM Engineer
AI Software Engineer
Machine Learning Software Engineer
Generative AI Engineer
AI Platform Engineer
```

Potential future loop:

```text
User Profile
     ↓
Generate search strategies
     ↓
Search multiple sources
     ↓
Collect jobs
     ↓
Analyze results
     ↓
Discover related job titles/queries
     ↓
Search again
```

This turns job discovery into an actual **agentic search problem**.

---

# 6. Application System

Eventually the system should:

```text
Job
 ↓
Application page
 ↓
Understand required fields
 ↓
Generate answers
 ↓
Select/customize resume
 ↓
Generate cover letter if appropriate
 ↓
Fill application
 ↓
Review
 ↓
Submit
```

However, this should NOT be part of the first MVP.

Application websites are highly variable and may involve:

- Different forms
- CAPTCHAs
- Login challenges
- Bot detection
- Changing page structures
- Different application questions
- Different upload requirements

Therefore, application automation should be introduced gradually.

---

# 7. Autonomy Levels

A major idea is to progressively increase autonomy.

### Level 0 — Discovery

Agent finds jobs.

### Level 1 — Evaluation

Agent finds + scores + ranks jobs.

### Level 2 — Application Assistant

Agent prepares application materials but user approves submission.

### Level 3 — Controlled Autonomous Applications

Agent automatically applies only when predefined conditions are satisfied.

### Level 4 — Monitoring

Agent monitors application-related emails and updates statuses.

### Level 5 — Adaptive Career Agent

Agent learns from application outcomes and improves future decisions.

---

# 8. Policy Engine

Autonomous application decisions should eventually be controlled by explicit policies.

Example:

```yaml
auto_apply:
  minimum_score: 90
  allowed_roles:
    - AI Engineer
    - ML Engineer
    - Backend Engineer
  allowed_work_modes:
    - remote
  minimum_salary: 50000

require_approval:
  score_range: 75-89

reject:
  score_below: 75
```

Conceptually:

```text
                    POLICY ENGINE
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
            Reject     Review    Auto-Apply
```

This is preferable to giving an LLM unrestricted authority.

---

# 9. Application Memory

The system should eventually remember previous applications.

Example:

```text
Company: Acme
Role: Backend Engineer

Previous Application:
- Resume: Resume_B
- Cover Letter: Version 3
- Application Answers
- Date Applied
- Result
```

If another similar job appears, the agent can use previous application information rather than starting from zero.

It should also know when the user has already applied to the same or similar position.

---

# 10. Application Decision Memory

The system should record not only applications but also **why decisions were made**.

Example:

```text
Job #3812
Score: 87

Decision: REJECTED

Reasons:
- Requires US work authorization
- Hybrid in NYC
- Violates location constraint
```

This makes the autonomous system debuggable and trustworthy.

---

# 11. Email Monitoring

Eventually integrate with an email provider such as Gmail/Outlook.

Workflow:

```text
Email
  ↓
Email ingestion
  ↓
Classification
  ↓
Match email to application
  ↓
Update application status
```

Possible statuses:

```text
Applied
Under Review
Recruiter Contacted
Interview
Rejected
Offer
Withdrawn
```

Example:

```text
Application #482
      ↓
"Applied"
      ↓
Recruiter email
      ↓
"Interview invitation"
      ↓
Status = INTERVIEW
```

---

# 12. Daily Digest

The agent should eventually send a daily summary containing things such as:

```text
Today's New Jobs

Top opportunities:
1. AI Engineer — 94%
2. Backend Engineer — 91%
3. ML Engineer — 88%

Applications:
- 3 automatically submitted
- 2 awaiting approval

Responses:
- 1 interview invitation
- 2 rejections

Important:
- Recruiter response from Company X
```

---

# 13. Feedback / Learning Loop

A future advanced feature is learning from actual outcomes.

For example:

```text
Jobs discovered
      ↓
Applications
      ↓
Responses
      ↓
Interviews
      ↓
Offers
      ↓
Analyze patterns
      ↓
Improve matching/search strategy
```

Potential future insights:

> "Your TypeScript/Node.js applications receive more responses than generic Software Engineer applications."

> "Remote AI Engineer roles have a higher interview rate for your profile."

> "Applications emphasizing project X perform better."

This should be treated as a later-stage capability, not MVP functionality.

---

# 14. Important Architectural Principle

Do NOT build the entire system as:

```text
LLM
 ↓
Do everything
```

Instead:

```text
                 ORCHESTRATOR
                      │
       ┌──────────────┼──────────────┐
       ▼              ▼              ▼
Job Discovery     Job Analysis    Application
       │              │              │
       ▼              ▼              ▼
Scrapers/APIs    LLM + Rules    Browser Agent
       │              │              │
       └──────────────┼──────────────┘
                      ▼
                 Job Database
                      │
                      ▼
                Application State
                      │
                      ▼
                 Notifications
```

Use deterministic software for:

- Database operations
- Deduplication
- Filtering
- Salary rules
- Location rules
- Application tracking
- Scheduling
- Retries
- Rate limiting
- Notifications
- Authentication
- State management

Use AI/LLMs for:

- Job understanding
- Semantic matching
- Reasoning
- Ranking
- Generating application answers
- Cover letters
- Interpreting recruiter emails
- Handling ambiguous requirements
- Other tasks requiring language/reasoning

Core principle:

> **Automate deterministic work with traditional software; use AI for reasoning; control autonomy with explicit policies.**

---

# 15. Proposed Product Evolution

### Phase 0 — Job Intelligence

```text
Profile
 ↓
Job Sources
 ↓
Collect Jobs
 ↓
Deduplicate
 ↓
Analyze
 ↓
Score
 ↓
Rank
 ↓
Daily Digest
```

### Phase 1 — Application Assistant

```text
High-quality job
 ↓
Generate application package
 ↓
User reviews
 ↓
User submits
```

### Phase 2 — Controlled Autonomous Applications

```text
Score + Rules
 ↓
High confidence?
 ↓
Auto-submit
```

### Phase 3 — Application Tracking

Track:

- Applications
- Status
- Dates
- Companies
- Roles
- Rejections
- Interviews
- Offers

### Phase 4 — Email Intelligence

Automatically detect recruiter/application emails and connect them to applications.

### Phase 5 — Feedback Loop

Use historical outcomes to improve search, scoring, and decision-making.

### Phase 6 — Full Personal Career Agent

The system manages most of the job-search process autonomously.

---

# 16. Recommended MVP

The first version should intentionally be much smaller.

### MVP objective

Prove:

> **Can an AI-powered system reliably discover and identify jobs that are genuinely relevant to a user's profile?**

MVP workflow:

```text
                  USER
                   │
                   ▼
             Profile Setup
                   │
                   ▼
             Job Discovery
                   │
                   ▼
              Job Database
                   │
                   ▼
            AI Job Analyzer
                   │
                   ▼
             Match Scoring
                   │
                   ▼
             Rank Jobs
                   │
                   ▼
            Daily Digest
                   │
                   ▼
             User Applies
```

MVP should probably include:

- User profile
- Resume/profile information
- Job source(s)
- Job collection
- Job normalization
- Deduplication
- Hard filtering
- AI job analysis
- Match scoring
- Explanation of score
- Job ranking
- Basic dashboard/digest

MVP should probably NOT include:

- Fully autonomous browser applications
- Complex browser agents
- Automatic email processing
- Learning/feedback loops
- Multi-agent complexity
- Dozens of job sources
- Autonomous decision-making without user approval

The MVP should prove the **core value proposition first**.

---

# 17. Important Product Philosophy

The system should evolve from:

> **Job Finder**

to:

> **Job Intelligence System**

to:

> **Application Assistant**

to:

> **Autonomous Job Agent**

to eventually:

> **Personal Career Agent**

The goal is not simply to automate clicking "Apply."

The more interesting product is one that understands:

- Who the user is
- What jobs are suitable
- Why a job is suitable
- Which jobs are worth applying to
- How to apply
- What happened after applying
- Which strategies produce results
- How to improve the job search over time


The final implementation should be designed so that coding agents such as Codex/Claude Code can execute the work from **clear, structured specifications**, while the human remains responsible for architecture, decisions, review, and validation.

---

# 18. Current Architecture Handoff (2026-08-23)

Product definition, requirements, user flows, domain modeling, detailed MVP security/data governance, and detailed discovery/background-work architecture are complete and accepted. The authoritative documents are `docs/product-definition.md`, `docs/requirements.md`, `docs/user-flows.md`, `docs/domain-model.md`, `docs/architecture.md`, and every ADR in `docs/adr/`.

The MVP remains an invite-only private beta with isolated individual accounts. It supports passwordless invited access; resume extraction followed by user review and immutable approved profiles; configurable constraints and preferences; scheduled per-user discovery plus guarded manual refresh; authorized compliance-first sources; normalization and conservative deduplication; explainable hybrid matching; and an in-app dashboard for job review and external application links. Notifications, email monitoring, application submission, browser agents, application/outcome tracking, learning loops, public sign-up, and billing remain out of scope.

Accepted system-architecture decisions:

- One modular system with separate interactive/control-plane and background-work runtime roles (ADR-008).
- Dedicated authentication and invitation capability (ADR-009).
- Durable, stateful coordination for long-running background work (ADR-010).
- Source adapters emit provenance-preserving observations to shared normalization (ADR-011).
- Explicit normalization, canonicalization, and availability-processing stages (ADR-012).
- Immutable, versioned user-specific evaluation snapshots with a current result view (ADR-013).
- User-scoped dashboard query and command boundary (ADR-014).
- Structured correlatable telemetry, distinct audit events, and sensitive-data minimization (ADR-015).

ADRs 016–046 additionally establish the MVP's security, data-governance, retry/recovery, idempotency/supersession, and evidence-weighted availability policies. ADR-047 selects the primary polyglot application stack: Next.js/TypeScript frontend, Node.js/TypeScript/Express authoritative backend, and internal FastAPI/Python AI processing. ADR-048 selects PostgreSQL as the sole authoritative MVP system of record. ADR-049 selects PostgreSQL-backed `pg-boss` for durable Node background work. ADR-050 selects private S3-compatible object storage for sensitive artifacts. ADR-051 selects custom policy-controlled passwordless identity in Express/PostgreSQL. ADR-052 approves Resend for narrowly scoped transactional email. ADR-053 selects Oracle Cloud Always Free for $0 private-beta hosting. ADR-054 approves Gemini's unpaid tier for tightly minimized, disclosed AI tasks: CareerPilot keeps all identity/evaluation mapping internally, but the residual unpaid-tier provider data-use and possible human-review risk remains explicit and accepted for the private beta. ADR-055 selects Ubuntu LTS, Docker Compose, and Caddy as the single-VM private-beta deployment baseline. ADR-056 selects OCI Vault with per-container Compose secrets for production credentials. Any material processor scope or terms change still requires the ADR-033 review and explicit decision-maker approval.
