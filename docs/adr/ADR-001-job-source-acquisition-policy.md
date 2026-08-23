# ADR-001: Use a Hybrid, Compliance-First Job Source Policy

## Status

Accepted — 2026-08-18

## Context

The MVP must discover enough relevant jobs to give each user a useful daily dashboard while remaining reliable and viable for a future multi-user product. Job sources differ materially in access method, data quality, coverage, cost, display rights, retention rules, and operational risk.

LinkedIn and Indeed are important job boards, but the product must not depend on unauthorized automated collection from them. Source access must be treated as a product, compliance, and operational concern—not merely as an implementation detail.

## Decision

The MVP will use a hybrid, compliance-first source portfolio:

- Use one authorized broad job-search data provider, selected only after validating coverage, pricing, permitted display/analysis use, attribution, rate limits, and retention rules for the intended markets.
- Add public, authorized company ATS job-board sources such as Greenhouse and Lever, initially through a curated catalog of relevant companies.
- Add specialized official sources when they materially serve a user segment or market.
- Permit users to manually add a job URL they found elsewhere for analysis and scoring.
- Do not scrape or otherwise automate collection from LinkedIn, Indeed, or any other source without explicit authorization appropriate to this product.

All automated sources must be behind a source-adapter boundary so individual integrations can be added, modified, disabled, or replaced without changing the rest of the system.

## Alternatives Considered

### A. Scrape major job boards

Provides apparent breadth quickly, but is brittle, operationally expensive, and incompatible with a durable multi-user product due to platform restrictions and access risk.

### B. Only direct official source APIs

Offers durable structured data, but its fragmented and company-specific coverage risks failing the MVP's daily-results goal.

### C. One licensed job-data aggregator

Provides broad initial coverage with low integration effort, but creates a single-source dependency and may have restrictive cost or data-use terms.

### D. Hybrid, compliance-first portfolio

Combines an authorized broad provider, direct ATS sources, and targeted official sources. This is the selected option.

### E. User-mediated import only

Allows scoring of externally discovered jobs but cannot satisfy autonomous daily discovery by itself.

## Why We Chose This

It offers the best balance of useful job coverage, sustainability, source resilience, and future multi-user viability. It also preserves the ability to add an authorized integration with a major job board later without a redesign.

## Consequences

### Positive

- Avoids making unauthorized scraping a dependency of the product.
- Supports broad discovery without reliance on a single source.
- Uses canonical company listings where available.
- Keeps source integrations replaceable.

### Negative

- Requires source-specific compliance and commercial validation.
- Requires robust cross-source deduplication.
- Does not automate LinkedIn or Indeed discovery in the MVP.
- Requires a curated company catalog for direct ATS sources.

### Risks

- An authorized broad provider may not adequately cover the intended roles or countries.
- Source terms, quotas, schemas, and availability can change.
- Duplicate and stale listings may reduce result quality.

## Revisit Conditions

Reconsider this decision if:

- a major board grants explicit access suitable for aggregation and display;
- validated source coverage cannot meet the MVP success metric;
- the economics or terms of the chosen broad provider become unsuitable; or
- product scope changes to a market not served by the selected sources.
