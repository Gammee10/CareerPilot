#!/usr/bin/env bash
# =============================================================================
# CareerPilot daily encrypted backup (T8.3, ADR-057).
#
#   pg_dump (custom format) -> client-side AES-256 encryption -> artifact in
#   BACKUP_DIR (or pushed via UPLOAD_CMD to the dedicated OCI bucket) ->
#   post-upload integrity verification -> 90-day retention cleanup.
#
# Required env:
#   PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD   (or PGPASSWORD_FILE)
#   BACKUP_ENCRYPTION_KEY_FILE                   (capability-scoped secret;
#                                                production value lives in OCI Vault per ADR-056)
# Optional:
#   BACKUP_DIR      (default ./backups)         local artifact directory
#   UPLOAD_CMD      e.g.: xargs -I{} oci os object put --bucket-name careerpilot-backup --file {}
#   RETENTION_DAYS  (default 90)
#
# Telemetry outcome is emitted as ONE minimized JSON line (no data content).
# On any failure: emits {"event":"backup_failed", ...} and exits non-zero so
# the VM health-check alerts the administrator (ADR-058).
# =============================================================================
set -uo pipefail

TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-90}"
KEY_FILE="${BACKUP_ENCRYPTION_KEY_FILE:?set BACKUP_ENCRYPTION_KEY_FILE}"
mkdir -p "$BACKUP_DIR"

telemetry() { # event, extra json (may be empty string)
  printf '{"ts":"%s","event":"%s"%s}\n' "$(date -u +%FT%TZ)" "$1" "${2:-}"
}

fail() {
  telemetry "backup_failed" ",\"stage\":\"$1\""
  exit 1
}

[ -r "$KEY_FILE" ] || fail "key_unreadable"

if [ -n "${PGPASSWORD_FILE:-}" ]; then
  export PGPASSWORD="$(cat "$PGPASSWORD_FILE")"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

START_MS="$(date +%s%3N)"

pg_dump -Fc -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" \
  -U "${PGUSER:-careerpilot}" -d "${PGDATABASE:-careerpilot}" \
  -f "$WORK/dump.bin" || fail "pg_dump"

openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in "$WORK/dump.bin" -out "$WORK/dump.bin.enc" \
  -pass file:"$KEY_FILE" || fail "encrypt"

DUMP_SHA="$(sha256sum "$WORK/dump.bin" | cut -d' ' -f1)"
ENC_SHA="$(sha256sum "$WORK/dump.bin.enc" | cut -d' ' -f1)"

ARTIFACT="$BACKUP_DIR/careerpilot-$TS.dump.enc"
mv "$WORK/dump.bin.enc" "$ARTIFACT" || fail "persist"

# Optional push to the dedicated private bucket.
if [ -n "${UPLOAD_CMD:-}" ]; then
  echo "$ARTIFACT" | $UPLOAD_CMD || fail "upload"
fi

# Post-upload integrity check: decrypt and compare digests.
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "$ARTIFACT" -out "$WORK/verify.bin" \
  -pass file:"$KEY_FILE" || fail "integrity_decrypt"
VERIFY_SHA="$(sha256sum "$WORK/verify.bin" | cut -d' ' -f1)"
if [ "$VERIFY_SHA" != "$DUMP_SHA" ]; then
  rm -f "$ARTIFACT"
  telemetry "backup_failed" ",\"stage\":\"integrity_mismatch\""
  exit 1
fi

END_MS="$(date +%s%3N)"

# Retention cleanup (mirrors bucket lifecycle rule).
find "$BACKUP_DIR" -name 'careerpilot-*.dump.enc' -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true

telemetry "backup_completed" ",\"artifact_sha256\":\"$ENC_SHA\",\"bytes\":$(wc -c < "$ARTIFACT"),\"durationMs\":$((END_MS - START_MS)),\"retentionDays\":$RETENTION_DAYS"
