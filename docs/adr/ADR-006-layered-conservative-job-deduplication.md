# ADR-006: Use Layered, Conservative Job Deduplication

## Status

Accepted — 2026-08-18

## Context

The MVP combines a broad provider and direct ATS sources. The same opportunity can appear through several sources, but superficially similar roles may be distinct requisitions, locations, or openings.

## Decision

Use layered, conservative matching. Automatically merge source listings only when a strong shared identifier or high-confidence evidence supports the merge. Preserve uncertain matches as separate candidates and preserve source provenance for every listing.

## Alternatives Considered

### A. Exact identifiers only

Safest but misses many cross-source duplicates.

### B. Aggressive similarity merging

Removes more duplicates but risks hiding a distinct opportunity through a false merge.

### C. Layered conservative matching

Balances duplicate reduction and protection against false merges. This is the selected option.

## Why We Chose This

Hiding a relevant opportunity through an incorrect merge is more harmful than occasionally showing similar jobs separately.

## Consequences

### Positive

- Reduces duplicate fatigue without relying on unsafe merges.
- Retains source evidence and supports future refinement.

### Negative

- Some duplicates may remain visible.
- Requires match-confidence logic and observability.

### Risks

- Overly conservative thresholds reduce deduplication value.
- Source data changes can affect match evidence.

## Revisit Conditions

Reconsider after measured duplicate and false-merge rates demonstrate that thresholds should change or the approach is insufficient.
