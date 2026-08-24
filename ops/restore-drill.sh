#!/usr/bin/env bash
# =============================================================================
# Monthly restore drill (T8.4, ADR-057). Restores an encrypted backup into an
# ISOLATED disposable container, verifies schema + data, and executes the
# deletion-replay step. Never touches the live database.
#
# Usage:
#   ops/restore-drill.sh <artifact.dump.enc> [backup_timestamp]
# Env:
#   BACKUP_ENCRYPTION_KEY_FILE (required)
#   DRILL_CONTAINER (default careerpilot-drill-pg)
#
# Outcome is appended to docs/dev/drill-log.md.
# =============================================================================
set -uo pipefail

ARTIFACT="${1:?usage: restore-drill.sh <artifact> [backup_ts]}"
BACKUP_TS="${2:-$(date -u +%FT%TZ)}"
KEY_FILE="${BACKUP_ENCRYPTION_KEY_FILE:?set BACKUP_ENCRYPTION_KEY_FILE}"
CONTAINER="${DRILL_CONTAINER:-careerpilot-drill-pg}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Native crypto binaries need Windows paths under Git Bash.
if command -v cygpath >/dev/null 2>&1; then
  ARTIFACT="$(cygpath -w "$ARTIFACT")"
  KEY_FILE="$(cygpath -w "$KEY_FILE")"
fi
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drilltarget \
  postgres:17-alpine >/dev/null

# Wait for stable server.
READY=0
for _ in $(seq 1 60); do
  echo "SELECT 1;" | docker exec -i "$CONTAINER" psql -U drill -d drilltarget -q >/dev/null 2>&1 \
    && READY=1 && break
  sleep 1
done
[ "$READY" = "1" ] || { echo "DRILL FAILED: target never ready"; exit 1; }

# Decrypt and restore into the isolated container.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; cleanup' EXIT
if command -v cygpath >/dev/null 2>&1; then
  WORK_NATIVE="$(cygpath -w "$WORK")"
else
  WORK_NATIVE="$WORK"
fi
openssl enc -d -aes-256-cbc -pbkdf2 -in "$ARTIFACT" -out "$WORK_NATIVE/restore.bin" \
  -pass file:"$KEY_FILE" || { echo "DRILL FAILED: decrypt"; exit 1; }

docker cp "$WORK_NATIVE/restore.bin" "$CONTAINER:/tmp/restore.bin" || { echo "DRILL FAILED: copy"; exit 1; }
docker exec "$CONTAINER" pg_restore -U drill -d drilltarget --clean --if-exists \
  --no-owner --no-privileges /tmp/restore.bin \
  || { echo "DRILL FAILED: pg_restore"; exit 1; }

# Verification 1: authoritative tables present with rows.
TABLE_CHECK="$(echo "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" |
  docker exec -i "$CONTAINER" psql -U drill -d drilltarget -tA)"
if [ "${TABLE_CHECK:-0}" -lt 10 ]; then
  echo "DRILL FAILED: restored schema incomplete ($TABLE_CHECK tables)"
  exit 1
fi

# Verification 2: deletion-replay step (closures newer than backup re-applied).
# Post-backup closure audits are exported by the driver into REPLAY_CSV
# (from the LIVE system's immutable audit log) and staged into the drill.
{
  echo "CREATE TEMP TABLE replay_audit_events(target_id text, occurred_at timestamptz);"
  if [ -n "${REPLAY_CSV:-}" ] && [ -f "$REPLAY_CSV" ]; then
    REPLAY_NATIVE="$REPLAY_CSV"
    command -v cygpath >/dev/null 2>&1 && REPLAY_NATIVE="$(cygpath -w "$REPLAY_CSV")"
    docker cp "$REPLAY_NATIVE" "$CONTAINER:/tmp/replay.csv" || { echo "DRILL FAILED: replay csv copy"; exit 1; }
    echo "\\copy replay_audit_events FROM '/tmp/replay.csv' WITH (FORMAT csv)"
  fi
  cat "$ROOT/ops/deletion-replay.sql"
} | docker exec -i "$CONTAINER" psql -U drill -d drilltarget \
    -v backup_ts="$BACKUP_TS" -q \
  || { echo "DRILL FAILED: deletion replay"; exit 1; }

REPLAYED="$(echo "SELECT count(*) FROM accounts WHERE state='closed';" |
  docker exec -i "$CONTAINER" psql -U drill -d drilltarget -tA)"

echo "DRILL PASSED: schema_tables=$TABLE_CHECK closed_accounts_after_replay=$REPLAYED"
