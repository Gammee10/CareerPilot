# ADR-046: Use Evidence-Weighted Job Availability

## Status

Accepted — 2026-08-23

## Context

Source collection can be partial, filtered, delayed, or unsuccessful. Treating one missing listing as closed would incorrectly hide live opportunities, while retaining every last-seen listing as active would make the dashboard stale and misleading. The MVP must distinguish explicit closure from inconclusive availability evidence.

## Decision

- An explicit authoritative source signal that a listing is closed or removed shall mark that listing unavailable.
- Mere absence from a collection result shall not by itself mark a listing or canonical job unavailable.
- If an active listing has no confirming observation beyond its source-specific freshness window, its availability shall become stale or uncertain rather than remain represented as confirmed active.
- A later active observation restores active status.
- The dashboard ranks only jobs believed active by default.
- Saved or historical unavailable, stale, or uncertain jobs remain retained and truthfully labeled.

This ADR does not select freshness-window values, availability algorithms, queries, schedulers, or implementation technology.

## Alternatives Considered

### A. Mark unavailable after one missed collection result

This is fast but can hide a live job after a partial, filtered, or failed source response.

### B. Mark unavailable only on explicit source closure or removal

This avoids false closure but can leave unconfirmed old listings represented as active for too long.

### C. Evidence-weighted availability

Use explicit closure when available; otherwise represent unconfirmed old evidence as stale or uncertain after a source-specific freshness window. This is the selected option.

## Why We Chose This

The selected policy avoids unsupported claims that a job is closed while also preventing old observations from being represented indefinitely as confirmed active. It realizes the availability-processing boundary and the listing-lifecycle requirement without undermining partial-run handling.

## Consequences

### Positive

- Partial or failed collection does not incorrectly hide live opportunities.
- The dashboard's default active view remains more trustworthy.
- Users retain saved and historical context with accurate uncertainty labels.

### Negative

- Each source requires an explicit freshness policy.
- Some listings will have an uncertain state rather than a definitive answer.

### Risks

- A freshness window that is too long can retain stale opportunities; one that is too short can create unnecessary uncertainty.
- Incorrect classification of a source signal as authoritative can misstate availability.

## Revisit Conditions

Reconsider if a source supplies stronger lifecycle guarantees, observed source behavior requires different freshness handling, or the product adds direct user reporting of listing availability.
