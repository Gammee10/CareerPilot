# Product Definition — Autonomous Job Search & Application Agent

## Status

Approved Phase 0 product definition — 2026-08-18

## Problem

Job seekers spend substantial time finding, comparing, and verifying relevant openings. Remote-job eligibility is especially ambiguous for users based outside the target job market. The product's initial value is to reduce this discovery and evaluation work while making the reasoning behind every recommendation clear.

## Product Vision

Evolve from a job-intelligence system into an application assistant and, later, a controlled personal career agent. The MVP proves the job-intelligence foundation; it does not automate applications.

## Initial Users

- Private, invite-only beta users.
- Each user has an individual account and isolated data.
- Initial validation focus: users based in Ethiopia seeking US-market, remote, software-engineering-related opportunities.
- The product must support user-configurable roles, locations, work modes, and preferences; it must not be structurally limited to that initial validation focus.

## MVP Objective and Success Hypothesis

Each morning, a user can open the dashboard and find 10–50 new, deduplicated, genuinely relevant jobs with direct links and clear match explanations, from which they can identify approximately 5–20 jobs worth applying to.

The volume is a target rather than a guarantee; relevance and the proportion judged worth applying to must also be evaluated.

## Core MVP Outcome

1. A user creates an account and completes a career profile.
2. The user uploads a resume.
3. The system extracts a reviewable profile draft from the resume.
4. The user reviews and edits it; user-approved profile fields are authoritative.
5. Scheduled discovery obtains jobs from approved sources.
6. The system normalizes, deduplicates, filters, analyzes, scores, explains, and ranks jobs.
7. The user reviews results in an in-app dashboard and follows a direct link to apply outside the product.

## Profile and Eligibility Principles

- Users configure career preferences and constraints, including their residence and countries or regions where they are authorized or able to work.
- A job is rejected only if its explicit residence, location, or work-authorization requirement clearly contradicts the user's profile.
- A job with unclear eligibility remains visible but is transparently marked as unverified and receives a modest, explainable ranking penalty.
- The dashboard must distinguish explicit ineligibility, confirmed eligibility, and unverified eligibility. It must never hide eligibility uncertainty merely by reducing a score.

## Source Policy

The project adopts ADR-001: a hybrid, compliance-first source portfolio.

- Use authorized broad search data, subject to source-specific validation of terms, cost, coverage, attribution, rate limits, and retention.
- Add authorized public company ATS sources, initially including Greenhouse and Lever through a curated company catalog.
- Add specialized official sources when they materially improve a supported user segment or market.
- Allow user-mediated job URL import for analysis and scoring.
- Do not scrape or otherwise automate collection from LinkedIn, Indeed, or other sources without explicit authorization suitable for this product.

## MVP Scope

- Invite-only accounts and user data isolation.
- Resume upload, extracted draft profile, and editable confirmed profile.
- Configurable career preferences and hard constraints.
- Scheduled job discovery, normalization, deduplication, eligibility filtering, analysis, explainable scoring, and ranking.
- In-app dashboard with direct application links.

## Explicit MVP Non-Goals

- Automatic application submission or browser agents.
- Email monitoring or email digests/notifications.
- Outcome-driven learning or adaptive search strategy.
- Public self-service sign-up, billing, organizations, or tenant administration.

## Constraints

- The MVP must be useful to a small private beta but avoid irreversible single-user assumptions.
- Sources must be replaceable and authorized for their intended use.
- Important recommendations and exclusions must be auditable and explainable.

## Open Decisions

All product-level decisions affecting the MVP have been made and are recorded in `docs/requirements.md`, `docs/domain-model.md`, and `docs/adr/`. The formerly open items were resolved as follows:

- Authorized source portfolio: Greenhouse, Lever, RemoteOK, plus user URL import (ADR-059).
- Profile fields, hard constraints, and preference schema: FR-3 through FR-5 (requirements §1).
- Job freshness and discovery schedule: FR-8 through FR-10a (requirements §2).
- Scoring dimensions, weights, and unknown-data treatment: FR-18 through FR-24 (requirements §5).
- Dashboard interaction model: accepted MVP user flows.
- Privacy, retention, and deletion requirements: ADRs 019 through 024 and 034 through 036.
