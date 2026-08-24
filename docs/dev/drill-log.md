# Restore-Drill Record (T8.4)

One entry per executed drill (ADR-057 requires at least monthly). Append-only.

| Date (UTC) | Artifact | Backup TS | Method | Result | Deletion-replay proof | Operator |
|---|---|---|---|---|---|---|
| 2026-08-24T22:47Z | backups-test/careerpilot-20260824T224646Z.dump.enc (sha256 f4bf…e2b4-era, full sha in telemetry line of scripts/test-backup.sh run) | 2026-08-24T22:46:46Z | `bash scripts/test-backup.sh` (disposable postgres:17-alpine container; restore into isolated `careerpilot-restore-drill-pg`; `--no-owner --no-privileges`) | **DRILL PASSED** — 27 public tables restored; integrity verified by decrypt-and-hash; post-backup closure audit replayed via ops/deletion-replay.sql | `closed_accounts_after_replay=1` — the account closed AFTER the backup was re-closed in the restored copy and its sessions terminated | coding agent (session, decision-maker review pending) |

## Procedure

See `ops/restore-drill.sh` + `docs/dev/restore-drill.md`. The monthly cadence
starts from this first recorded execution.
