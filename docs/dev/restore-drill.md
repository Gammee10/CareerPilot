# Restore Drill Runbook (T8.4, ADR-024/057)

Monthly drill: restore the latest encrypted backup into an ISOLATED
disposable container, verify the schema, and prove that closure/deletion
decisions newer than the backup are RE-APPLIED (deletion replay).

## Automated drill

`scripts/test-backup.sh` performs the full cycle against a disposable
database and container:

1. Fresh PostgreSQL 17 container; migrations applied; one account seeded.
2. `ops/backup.sh`: pg_dump -Fc → AES-256-CBC encrypt → sha256 → artifact.
3. Account is closed AFTER the snapshot (live audit log gains a closure).
4. `ops/restore-drill.sh <artifact> <backup_ts>`:
   - decrypt + `pg_restore --no-owner --no-privileges` into an isolated
     container;
   - assert restored schema completeness;
   - import post-backup closure audits from the live immutable audit log;
   - run `ops/deletion-replay.sql` to re-apply those closures and terminate
     any sessions in the restored copy;
   - print `DRILL PASSED ... closed_accounts_after_replay=N`.
5. Tamper check: a corrupted artifact must fail decryption.

## Production cadence (VM)

1. Ensure last night's artifact exists in the backup bucket
   (`BACKUP_DIR` mirror or `oci os object get`).
2. Run `ops/restore-drill.sh` with the Vault-held key file.
3. Append the outcome line to `docs/dev/drill-log.md`.
4. Any failure opens an incident per ADR-058 alerting rules.

## Deletion-replay source of truth

The LIVE system's append-only `audit_events` (`action='account.closed'`)
exported AFTER the backup timestamp. The restored copy cannot contain them,
which is exactly why replay is required before the restored copy is used for
anything beyond verification.
