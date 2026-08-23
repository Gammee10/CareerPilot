# ADR-059: Initial Authorized Source Portfolio and Adapter Limit Framework

## Status

Accepted — 2026-08-23

## Context

ADR-001 establishes a compliance-first hybrid source policy but does not select the initial providers. The MVP success hypothesis (10–50 genuinely relevant, deduplicated remote US software jobs per day) depends on a source portfolio that produces day-one value while remaining fully authorized. Greenhouse and Lever expose employer-published postings through public ATS job-board APIs; RemoteOK publishes a public job-posting API for remote roles relevant to the beta's initial validation segment. The product definition excludes scraping LinkedIn, Indeed, or any unauthorized source. User-mediated URL import for analysis and scoring is already approved.

## Decision

The MVP's initial authorized source portfolio is:

1. **Greenhouse** — employer-published postings via its public boards API.
2. **Lever** — employer-published postings via its public postings API.
3. **RemoteOK** — public remote-job posting API.
4. **User-mediated URL import** — already-approved analysis/scoring path; not an automated collection adapter.

Explicitly excluded for the MVP: LinkedIn, Indeed, aggregators without validated terms (e.g., Adzuna, Jooble), and all HTML scraping. Each automated source must pass its own documented ADR-033 review — verifying current terms, attribution, retention, display restrictions, and rate-limit expectations — before any data flows through it. This ADR selects the portfolio; it does not itself complete those reviews.

Default adapter limit framework (starting values, operationally tunable within source policy without a new ADR):

- Scheduled collection once daily within each user's discovery run; manual refresh subject to a per-user minimum interval of approximately 6 hours, coalesced under ADR-042.
- Conservative fixed rate limits per adapter (approximately ≤1 sustained request/second with small burst), independent of observed provider tolerance, plus honoring of any `Retry-After` signals.
- Bounded result-page budget per query per run (approximately ≤20 pages) so a pathological query cannot loop unbounded.
- Short per-request timeouts and at most 3 attempts for clearly transient failures only, within ADR-044's bounded, source-policy-aware retry rules.
- Retention and display governed by ADR-021, including any stricter source-specific limits confirmed during each source's ADR-033 review.

This decision does not select adapter implementation code, HTTP libraries, company-catalog content, search-term generation, or exact numeric tuning beyond the stated defaults.

## Alternatives Considered

### Option A — Greenhouse + Lever + RemoteOK

All authorized public-API sources, $0, directly relevant to the remote-first validation segment. Gap: Greenhouse/Lever contribute little until a curated company catalog exists. This is the selected option.

### Option B — Greenhouse + Lever only

Cleanest minimal posture, but near-zero day-one volume without substantial hand-curated catalog work before launch.

### Option C — Add a free-tier aggregator API

Broad immediate coverage, but each aggregator requires individual terms validation and processor review, and aggregator data quality for non-US-resident remote eligibility is often poor.

### Option D — Substitute Remotive for RemoteOK

Comparable public-API remote board posture; largely interchangeable. Remotive may be added later through its own review if terms quality justifies it.

## Why We Chose This

Option A maximizes authorized day-one coverage for the beta's target segment while keeping every source on public, intended-for-job-seekers APIs. The limit framework enforces conservative behavior that does not rely on provider tolerance and satisfies ADRs 044–046 without new mechanisms.

## Consequences

### Positive

- Day-one authorized discovery from three independent adapters plus user-imported URLs.
- Source independence preserves partial-run resilience under ADR-043.
- Limits are explicit, bounded, and tunable without reopening architecture decisions.

### Negative

- Greenhouse/Lever value depends on curating a company catalog, which is ongoing content work rather than a one-time build.
- Three adapters mean three ADR-033 validations to maintain as terms evolve.

### Risks

- Provider terms or API shapes may change; adapters remain independently disableable under ADR-011/FR-10a.
- RemoteOK's current terms must be re-verified at its ADR-033 review; approval here does not pre-validate them.
- Aggregator-class coverage gaps may require revisiting Option C if relevance volume falls short of the success hypothesis.

## Revisit Conditions

Revisit if beta evaluation shows insufficient relevant volume, if any provider's terms change materially, when adding any new source (each requiring its own ADR-033 review), or if the company-catalog burden proves unsustainable.
