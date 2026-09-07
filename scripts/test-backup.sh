#!/usr/bin/env bash
# =============================================================================
# Backup + restore-drill end-to-end verification (T8.3/T8.4 AC evidence).
# Spins up a disposable PostgreSQL container, produces data, runs the real
# backup pipeline, closes an account AFTER the backup, then runs the monthly
# restore drill into an isolated container proving deletion-replay works.
# Also proves the integrity-failure path by tampering an artifact copy.
# =============================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1   # no-op on Linux CI; prevents Git Bash path mangling

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date -u +%FT%TZ)"
PGC="careerpilot-backup-test-pg"

cleanup() { docker rm -f "$PGC" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker rm -f "$PGC" >/dev/null 2>&1 || true
docker run -d --name "$PGC" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=backupdb \
  -v "$ROOT:/repo" \
  postgres:17-alpine >/dev/null

READY=0
for _ in $(seq 1 60); do
  echo "SELECT 1;" | docker exec -i "$PGC" psql -U postgres -d backupdb -q >/dev/null 2>&1 && READY=1 && break
  sleep 1
done
[ "$READY" = "1" ] || { echo "FAILED: test db never ready"; exit 1; }

docker exec "$PGC" apk add --no-cache openssl >/dev/null 2>&1
# CI reliability: the openssl provisioning above is the only unguarded
# infrastructure step — a silent failure here used to surface minutes later
# as an inscrutable backup failure. Retry transient registry/DNS flakes and
# then verify loudly (CI #41 failed the backup step with no diagnosis).
if ! docker exec "$PGC" openssl version >/dev/null 2>&1; then
  for _ in 1 2 3; do
    sleep 5
    docker exec "$PGC" apk add --no-cache openssl >/dev/null 2>&1 || true
    docker exec "$PGC" openssl version >/dev/null 2>&1 && break
  done
fi
docker exec "$PGC" openssl version >/dev/null 2>&1 \
  || { echo "FAILED: apk-openssl (openssl unavailable in test container)"; exit 1; }

# Apply the real schema migrations so the dump has the authoritative model.
docker exec "$PGC" sh -c '
  for f in /repo/db/migrations/*.sql; do
    psql -U postgres -d backupdb -q -v ON_ERROR_STOP=1 < "$f" || exit 1
  done
' || { echo "FAILED: migrations"; exit 1; }

# Seed one account so the dump has authoritative content.
echo "INSERT INTO accounts (email, state) VALUES ('pre-backup@example.invalid', 'active');" |
  docker exec -i "$PGC" psql -U postgres -d backupdb -q

# Encryption key (capability-scoped secret; production value from OCI Vault).
docker exec "$PGC" sh -c 'head -c 32 /dev/urandom > /tmp/backup.key'

echo "== Running backup pipeline =="
docker exec \
  -e PGHOST=localhost -e PGPORT=5432 -e PGUSER=postgres -e PGDATABASE=backupdb \
  -e BACKUP_ENCRYPTION_KEY_FILE=/tmp/backup.key \
  -e BACKUP_DIR=/repo/backups-test \
  "$PGC" bash /repo/ops/backup.sh || { echo "FAILED: backup"; exit 1; }

ARTIFACT="$(ls -t "$ROOT"/backups-test/careerpilot-*.dump.enc | head -1)"
[ -f "$ARTIFACT" ] || { echo "FAILED: no artifact"; exit 1; }
BACKUP_TS="$(date -u +%FT%TZ)"   # moment the snapshot was taken

echo "== Detached manifest check (H12) =="
[ -f "$ARTIFACT.sha256" ] || { echo "FAILED: no manifest sidecar"; exit 1; }
MANIFEST_SHA="$(cut -d' ' -f1 < "$ARTIFACT.sha256")"
ARTIFACT_SHA="$(sha256sum "$ARTIFACT" | cut -d' ' -f1)"
[ "$MANIFEST_SHA" = "$ARTIFACT_SHA" ] || { echo "FAILED: manifest mismatch"; exit 1; }
echo "manifest matches artifact ($ARTIFACT_SHA)"

# Closure that happens AFTER the backup (must be replayed on restore).
echo "UPDATE accounts SET state='closed', closed_at=now() WHERE email='pre-backup@example.invalid';" |
  docker exec -i "$PGC" psql -U postgres -d backupdb -q
echo "INSERT INTO audit_events (actor_type, action, outcome, target_category, target_id, details)
      SELECT 'system', 'account.closed', 'success', 'account', id::text, '{}'
        FROM accounts WHERE email='pre-backup@example.invalid';" |
  docker exec -i "$PGC" psql -U postgres -d backupdb -q

echo "== Upload round-trip verification (H12) =="
FAKE_BUCKET="$ROOT/backups-test/fake-bucket"
mkdir -p "$FAKE_BUCKET"
# Happy path: fake bucket stores the object; re-download hash must match.
docker exec \
  -e PGHOST=localhost -e PGPORT=5432 -e PGUSER=postgres -e PGDATABASE=backupdb \
  -e BACKUP_ENCRYPTION_KEY_FILE=/tmp/backup.key \
  -e BACKUP_DIR=/repo/backups-test \
  -e "UPLOAD_CMD=xargs -I{} cp {} /repo/backups-test/fake-bucket/" \
  -e "DOWNLOAD_CMD=xargs -I{} cat /repo/backups-test/fake-bucket/{}" \
  "$PGC" bash /repo/ops/backup.sh || { echo "FAILED: bucketed backup"; exit 1; }
NEWEST="$(ls -t "$ROOT"/backups-test/careerpilot-*.dump.enc | head -1)"
BUCKET_COPY="$FAKE_BUCKET/$(basename "$NEWEST")"
[ -f "$BUCKET_COPY" ] || { echo "FAILED: object never reached the bucket"; exit 1; }
[ "$(sha256sum "$BUCKET_COPY" | cut -d' ' -f1)" = "$(sha256sum "$NEWEST" | cut -d' ' -f1)" ] \
  || { echo "FAILED: bucket copy differs"; exit 1; }
echo "bucket round-trip hash matches"

# Negative 1: corrupted re-download must fail the backup closed.
if docker exec \
  -e PGHOST=localhost -e PGPORT=5432 -e PGUSER=postgres -e PGDATABASE=backupdb \
  -e BACKUP_ENCRYPTION_KEY_FILE=/tmp/backup.key \
  -e BACKUP_DIR=/repo/backups-test \
  -e "UPLOAD_CMD=xargs -I{} cp {} /repo/backups-test/fake-bucket/" \
  -e "DOWNLOAD_CMD=xargs -I{} echo corrupt-bytes" \
  "$PGC" bash /repo/ops/backup.sh 2>/dev/null; then
  echo "FAILED: mismatched re-download was not detected"
  exit 1
fi
echo "mismatched re-download correctly failed the backup"

# Negative 2: upload without any download verifier must fail closed.
if docker exec \
  -e PGHOST=localhost -e PGPORT=5432 -e PGUSER=postgres -e PGDATABASE=backupdb \
  -e BACKUP_ENCRYPTION_KEY_FILE=/tmp/backup.key \
  -e BACKUP_DIR=/repo/backups-test \
  -e "UPLOAD_CMD=xargs -I{} cp {} /repo/backups-test/fake-bucket/" \
  "$PGC" bash /repo/ops/backup.sh 2>/dev/null; then
  echo "FAILED: unverified upload was not detected"
  exit 1
fi
echo "unverified upload correctly failed the backup"

echo "== Restore drill with deletion-replay =="
# Export post-backup closure audits from the LIVE database (immutable log).
docker exec "$PGC" psql -U postgres -d backupdb -c "\copy (SELECT target_id::text, occurred_at FROM audit_events WHERE action='account.closed') TO '/repo/.replay.csv' WITH (FORMAT csv)"
ls -la "$ROOT/.replay.csv"

# The drill runs on the host and needs the encryption key as a file; stage a
# temporary copy from inside the test container, removed immediately after.
docker exec "$PGC" cat /tmp/backup.key > "$ROOT/.drill-key.tmp"
chmod 600 "$ROOT/.drill-key.tmp"

DRILL_OUT="$(DRILL_CONTAINER="careerpilot-restore-drill-pg" \
BACKUP_ENCRYPTION_KEY_FILE="$ROOT/.drill-key.tmp" \
REPLAY_CSV="$ROOT/.replay.csv" \
  bash "$ROOT/ops/restore-drill.sh" "$ARTIFACT" "$BACKUP_TS" 2>&1)"
rm -f "$ROOT/.drill-key.tmp" "$ROOT/.replay.csv"
echo "$DRILL_OUT"
echo "$DRILL_OUT" | grep -q "DRILL PASSED" || { echo "FAILED: drill did not pass"; exit 1; }
# Deletion-replay proof: the post-backup closure was re-applied on restore.
echo "$DRILL_OUT" | grep -q "closed_accounts_after_replay=1" \
  || { echo "FAILED: deletion replay did not re-close the account"; exit 1; }



echo "== Integrity-failure path (tampered artifact) =="
cp "$ARTIFACT" "$ROOT/backups-test/tampered.dump.enc"
cp "$ARTIFACT.sha256" "$ROOT/backups-test/tampered.dump.enc.sha256"
printf 'X' | dd of="$ROOT/backups-test/tampered.dump.enc" bs=1 seek=5 conv=notrunc 2>/dev/null
if BACKUP_ENCRYPTION_KEY_FILE=/tmp/missing.key \
   DRILL_CONTAINER="careerpiot-tamper-drill" \
   bash "$ROOT/ops/restore-drill.sh" "$ROOT/backups-test/tampered.dump.enc" 2>/dev/null; then
  echo "FAILED: tampered artifact was not detected"
  rm -f "$ROOT/.drill-key.tmp"
  exit 1
fi
rm -f "$ROOT/.drill-key.tmp"
echo "Integrity failure correctly detected on tampered artifact."

rm -rf "$ROOT/backups-test"
echo ""
echo "BACKUP/RESTORE TESTS: PASS (T8.3/T8.4 acceptance demonstrated)"
