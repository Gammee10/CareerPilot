# ADR-057: Use Daily Encrypted PostgreSQL Backups with Verified Restores

## Status

Accepted — 2026-08-23

## Context

PostgreSQL is the sole authoritative system of record (ADR-048) and runs self-managed in one container on the single Always Free VM (ADR-053, ADR-055). VM loss, disk failure, a bad deployment, or Oracle idle-instance reclamation would otherwise irrecoverably destroy all accounts, profiles, evaluations, source records, and audit metadata. ADR-024 requires recovery copies to expire within 90 days and requires deletion requests to be re-applied after any restore, but deliberately left backup technology and procedures open. The team owns recovery verification under ADR-053. Raw artifacts already have OCI Object Storage as their primary store under ADR-050.

## Decision

The private beta uses daily encrypted logical backups of the authoritative PostgreSQL database:

- One `pg_dump` (custom format, compressed) per day; recovery point objective is 24 hours.
- Backup files are encrypted client-side on the VM before leaving it. The backup-encryption key is capability-scoped and held in OCI Vault with other production secrets (ADR-056); it is not shared with application or artifact-storage credentials.
- Backups are uploaded to a dedicated private OCI Object Storage backup bucket that is distinct from the resume/artifact bucket.
- Bucket lifecycle rules expire backups no later than 90 days after creation, consistent with ADR-024's recovery-copy bound.
- Each backup receives an automated post-upload integrity check (checksum verification plus successful `pg_restore --list` parsing); the outcome is recorded as an operational telemetry event under ADR-015 minimization rules.
- A documented restore drill is performed at least monthly: restore the latest backup into an isolated throwaway container, verify data integrity, verify that valid deletion requests are re-applied after restoring from a pre-deletion backup (per ADR-024), and record the drill outcome as an audit-recorded operational event.
- The restore runbook is a version-controlled operational artifact subject to the security/privacy release-validation gate (ADR-030), alongside the Compose configuration.
- Secrets are not backed up; OCI Vault remains their sole source of truth.
- No second backup pipeline is built for resume/artifact objects in this beta; OCI infrastructure durability of the primary artifact bucket is accepted, with the separate backup bucket providing distinct blast-radius control for database content.

This decision does not select backup scripts, scheduling mechanisms, encryption libraries, monitoring implementation, or CI/CD tooling.

## Alternatives Considered

### Option A — Daily encrypted logical dump to a separate backup bucket

Simple, $0 within Always Free limits, portable to any future PostgreSQL host, and straightforward to verify against ADR-024 obligations. Sacrifices point-in-time recovery; up to 24 hours of work can be lost. This is the selected option.

### Option B — Continuous WAL archiving (WAL-G/pgBackRest)

Near-zero RPO, but adds a running archiving component, materially more complex restore behavior, more storage operations, and harder verification. Unjustified operational burden while losing less than a day of beta evaluations is tolerable.

### Option C — VM/disk-level snapshots only

Captures everything, including misconfigured or compromised states; whole-VM restore is heavy, does not prove logical database restorability, and coarser retention hygiene makes bounded recovery copies and deletion replay harder to govern under ADR-024.

## Why We Chose This

Option A satisfies recoverability, bounded retention, deletion re-application, and verification requirements at private-beta scale without new running components or cost. It preserves full portability of the restore path to managed infrastructure later.

## Consequences

### Positive

- Loss of the VM no longer means loss of all authoritative data.
- Recovery-copy expiry is mechanically enforced by bucket lifecycle, not discipline.
- Monthly drills provide evidence that backups are actually usable, satisfying ADR-053's owned responsibility.
- Deletion guarantees remain enforceable through the restore-time deletion-replay check.

### Negative

- Up to 24 hours of discovery, evaluation, and review work can be lost in a failure.
- Restore requires a manual runbook execution by an administrator.
- Artifact objects rely on provider durability rather than CareerPilot-managed secondary copies during the beta.

### Risks

- A missed daily backup silently widens the effective RPO beyond 24 hours; backup success/failure must be observable through operational status (detailed monitoring/alerting remains Decision 2).
- Human error during restore could expose data outside intended scope; the drill procedure mitigates but does not eliminate this.
- If data volume grows beyond Always Free storage limits, backup retention or destination needs explicit review rather than silent paid usage (ADR-053).

## Revisit Conditions

Reconsider if beta users experience material loss from a mid-day failure (favoring WAL archiving), if data volume exceeds free limits, if the monthly drill cannot be sustained operationally, or when migrating to managed infrastructure where provider-native backup services should be evaluated.
