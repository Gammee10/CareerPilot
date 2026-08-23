# ADR-043: Preserve Partial Discovery Results with Truthful Status

## Status

Accepted — 2026-08-23

## Context

A discovery run can receive usable results from some authorized sources while another source fails, is rate-limited, or returns partial data. The MVP needs to retain useful results without implying complete source coverage or concealing an operational failure.

## Decision

- A discovery run may complete partially; a failure or partial result from one source does not discard usable results from other sources.
- Each source collection attempt records its outcome, including successful, failed, rate-limited, or partial status, with relevant timing and scope metadata.
- The dashboard and operational views shall present truthful run status and must not represent a partial run as complete coverage.
- Successful observations proceed through the established normalization, availability, and evaluation policies.
- Failed or partial sources remain eligible for later scheduled or permitted manual collection under their source policy.

This ADR does not select retry algorithms, queues, monitoring products, or implementation technology.

## Alternatives Considered

### A. Fail the entire run when any source fails

This provides a simple outcome but discards useful results and overstates the importance of one source failure.

### B. Preserve successful results and record truthful partial status

Keep usable results while recording failed or partial source attempts and reporting incomplete coverage accurately. This is the selected option.

### C. Hide failures and show only resulting jobs

This preserves a simple user view but misrepresents coverage and obscures operational problems.

## Why We Chose This

The selected policy maintains product usefulness during ordinary external-source instability while preserving the provenance and truthful status required for an explainable discovery experience.

## Consequences

### Positive

- Usable jobs remain available despite an isolated source problem.
- Source-specific issues are observable and explainable.
- The product avoids falsely implying complete discovery coverage.

### Negative

- Run and dashboard status require a partial-completion state.
- Users may need concise explanation of what incomplete coverage means.

## Revisit Conditions

Reconsider if a future source becomes mandatory for a specific product promise, or if the product adds user-configurable source coverage requirements.
