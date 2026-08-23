# ADR-058: Self-Hosted File-Based Observability Baseline with Email Alerts

## Status

Accepted — 2026-08-23

## Context

ADRs 015, 021, 043–046, and 057 assume observable operational outcomes: backup success/failure, partial discovery runs, retry exhaustion, bounded telemetry retention, and truthful status. The beta runs all containers on one Always Free VM (ADR-055) under a $0 constraint (ADR-053), with no monitoring product selected. Without minimal monitoring, a silently missed daily backup or a stopped background worker is discovered only at data-loss time. A full self-hosted metrics stack or external SaaS monitoring would add cost, RAM pressure, or an additional external processor requiring its own ADR-033 review.

## Decision

The private beta uses a self-hosted, single-VM, file-based observability baseline:

- **Structured application logging.** Both Node runtime roles and the internal FastAPI capability emit structured JSON logs to stdout/stderr containing correlation identifiers, run/work-unit identifiers, source, and event category. The Compose logging configuration captures them to local files on the VM with size-based rotation.
- **Log content minimization.** Logs follow ADR-015: no resumes, profile content, full job text, AI inputs or outputs, or secrets. Local log retention aligns with ADR-021's 90-day operational-telemetry bound, enforced by rotation policy.
- **Health checks.** Each container exposes a lightweight health endpoint. A scheduled health-check script on the VM verifies container state, free disk space, PostgreSQL reachability, and daily-backup success per ADR-057, recording outcomes as telemetry events.
- **Operational status surface.** Health-check results are written to a status source that the dashboard's truthful-status behavior and operational investigation can read across both runtime roles.
- **Alerting via Resend, administrator-facing only.** Essential operational alert emails — missed/failed daily backup, repeated container restarts, disk usage above threshold, and restore-drill due or failed — are sent through the approved Resend boundary to the administrator address. No SMS, pager, chat, or on-call integration exists in the beta. Resend's approved purpose expansion for this narrow administrator-facing use is recorded in ADR-052; no additional data beyond the administrator recipient address and minimum message content is sent.
- **No metrics stack, tracing, APM product, or external log service.** pg-boss queue depth and job-failure counts are observed through simple scheduled queries logged as telemetry events rather than a dedicated metrics stack.

This decision does not select logging libraries, log-schema tooling, scheduler implementation, threshold values, email templates, or CI/CD.

## Alternatives Considered

### Option A — Structured logs plus health-check script plus Resend email alerts

$0 cost, near-zero footprint, satisfies every accepted policy obligation. Weakest detection latency (minutes via scheduling, not seconds) and no dashboards. Total VM failure cannot self-report. This is the selected option.

### Option B — Self-hosted Prometheus + Grafana + Loki containers

Real dashboards and alert rules, but three more always-running containers competing for Always Free resources, with their own maintenance burden — disproportionate for private-beta scale.

### Option C — Free-tier external monitoring SaaS

Off-VM visibility (detects total VM death, which Option A cannot) but sends operational metadata to another processor requiring an ADR-033 review, with free-tier retention and overage constraints conflicting with governance discipline. Remains available later as a separately reviewed addition.

## Why We Chose This

Option A closes the highest-risk observability gaps — silent backup failure, dead background work, disk exhaustion — while respecting the $0 constraint, the sensitive-data boundary, and the processor approval gate. Detection latency and total-failure blindness are acceptable for invite-only beta scale.

## Consequences

### Positive

- Backup failure, worker failure, and disk exhaustion produce alerts within minutes.
- All accepted observability obligations (ADR-015 minimization, ADR-021 retention, ADR-057 verification evidence) have concrete mechanisms.
- No new running services and no new external processors.

### Negative

- Minute-scale detection granularity; no graphs or historical dashboards.
- Total VM failure is detected only by human noticing unavailability; the monthly restore drill doubles as a liveness check.
- Log files consume VM disk and depend on correct rotation to honor the 90-day bound.

### Risks

- The alert path itself can fail (Resend outage, expired address); alerts are best-effort, not guaranteed delivery.
- Log volume growth or rotation misconfiguration could exhaust disk or over-retain data.
- Without dashboards, trend detection (slow degradation) relies on periodic human review.

## Revisit Conditions

Reconsider if beta scale or incident experience demonstrates that minute-latency file-based monitoring is inadequate, if log volume threatens Always Free limits, when migrating to managed infrastructure, or if off-VM failure detection becomes required — the latter through a separate ADR-033 review of any external monitoring processor.
