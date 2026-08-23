# ADR-042: Coalesce Overlapping Discovery Requests Per User

## Status

Accepted — 2026-08-23

## Context

Scheduled discovery, guarded manual refresh, and a material profile change can request discovery for the same user at nearly the same time. Concurrent runs duplicate source collection and can compete to produce current results. Rejecting every request while work is active can lose a meaningful refresh or updated profile.

## Decision

- Only one discovery run may be active for a user at a time.
- Overlapping scheduled, manual, or material-profile-change requests are coalesced into at most one follow-up run.
- The follow-up run uses the user's latest approved profile and active discovery scope when it begins.
- The run record shall distinguish the initiating and coalesced reasons sufficiently to support truthful dashboard status and operations.
- Existing immutable evaluation and current-result rules apply to each completed run.

This ADR does not select queues, locks, schedulers, concurrency primitives, or implementation technology.

## Alternatives Considered

### A. Run every request concurrently

This maximizes immediate throughput but duplicates collection and can create conflicting or wasteful evaluation work.

### B. One active run with one coalesced follow-up run

Serialize discovery per user and retain at most one follow-up request using the latest approved profile. This is the selected option.

### C. Reject all requests while a run is active

This prevents overlap but can discard meaningful manual refreshes and profile updates.

## Why We Chose This

The selected approach keeps discovery work bounded and coherent for each isolated account, while preserving the user's most recent intent and profile state.

## Consequences

### Positive

- Avoids duplicate source collection and competing current-result updates.
- A meaningful request received during active work is not lost.
- Latest approved profile data is used for the follow-up run.

### Negative

- A manual refresh can complete after currently active work rather than immediately.
- Run state must retain coalesced reasons and truthful status.

## Revisit Conditions

Reconsider if the product introduces distinct, independent discovery scopes that must run concurrently for one user.
