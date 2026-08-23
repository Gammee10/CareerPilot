# ADR-002: Use Hybrid, Explainable Job Matching

## Status

Accepted — 2026-08-18

## Context

The MVP's core value depends on identifying genuinely relevant jobs and making recommendations trustworthy. Job descriptions and resumes contain ambiguous, incomplete, and varied natural language, while user eligibility and hard constraints require predictable treatment.

## Decision

Use a hybrid matching model:

- Deterministic software applies hard constraints, maintains state, and calculates rule-based factors.
- AI-assisted analysis extracts and interprets job requirements and supports semantic matching.
- The product exposes named match dimensions, an overall score, supporting evidence, gaps, and uncertainty.
- A hard-constraint failure cannot be overridden by an AI score.

## Alternatives Considered

### A. Single opaque AI score

Flexible but insufficiently auditable, repeatable, or debuggable for a product that affects job-search decisions.

### B. Pure rules-based matching

Predictable and explainable but unable to robustly interpret varied titles, transferable skills, and natural-language requirements.

### C. Hybrid model

Combines deterministic control with AI's language understanding. This is the selected option.

## Why We Chose This

It best satisfies the need for relevance, explainability, explicit policy enforcement, and future controlled autonomy.

## Consequences

### Positive

- Users can understand and challenge a recommendation.
- Eligibility and hard constraints remain deterministic.
- The model can interpret non-standard titles and descriptions.

### Negative

- Requires schema validation and evaluation safeguards for AI-derived data.
- More design work than a single score.
- Some job facts will remain unknown or ambiguous.

### Risks

- Inconsistent AI interpretation can affect ranking.
- Poor score calibration could give users misleading confidence.
- Overly rigid deterministic rules can exclude suitable jobs.

## Revisit Conditions

Reconsider if measured evaluation quality shows that the hybrid model cannot meet relevance goals, if a materially better authorized matching capability becomes available, or if later outcome data justifies a different calibration approach.
