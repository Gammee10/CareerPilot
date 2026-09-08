#!/usr/bin/env bash
# L8 — stub-based tests for ops paths that never run in CI otherwise:
#   1. fetch-vault-secrets.sh against a stub `oci` (arg contract + decode + modes)
#   2. health-check.sh DRY_RUN against stub `docker`/`df` (alert codes, exit codes)
#   3. backup.sh UPLOAD_CMD round-trip + retention cleanup + flock busy-lock
#      against a stub `pg_dump` (real openssl)
# Pure bash + coreutils + openssl; no Docker, no DB, no network.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1"; }

# ---------------------------------------------------------------- vault fetch
echo "--- fetch-vault-secrets.sh (stub oci) ---"
STUBBIN="$WORK/stubbin"
mkdir -p "$STUBBIN"
cat > "$STUBBIN/oci" <<'EOF'
#!/usr/bin/env bash
# Records its args, then emits ONLY the base64 content — emulating oci's
# client-side --query ... --raw-output filtering of the bundle document.
echo "$*" >> "$OCI_ARGS_LOG"
name=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--secret-bundle-name" ]; then name="$a"; fi
  prev="$a"
done
printf 'value-for-%s' "$name" | base64 -w0
EOF
chmod +x "$STUBBIN/oci"
export OCI_ARGS_LOG="$WORK/oci-args.log"
touch "$OCI_ARGS_LOG"

rm -rf "$ROOT/secrets/prod"
PATH="$STUBBIN:$PATH" bash "$ROOT/scripts/fetch-vault-secrets.sh" > "$WORK/vault.log" 2>&1
for n in postgres_password session_signing_key resend_api_key gemini_api_key ai_internal_token; do
  f="$ROOT/secrets/prod/$n.txt"
  if [ "$(cat "$f" 2>/dev/null)" = "value-for-careerpilot-$n" ]; then ok "vault decoded $n"; else bad "vault content $n"; fi
  if [ "$(stat -c %a "$f" 2>/dev/null)" = "600" ]; then ok "vault mode 600 $n"; else bad "vault mode $n"; fi
done
[ "$(stat -c %a "$ROOT/secrets/prod")" = "700" ] && ok "vault dir 700" || bad "vault dir mode"
if grep -q 'secret-bundle-content' "$OCI_ARGS_LOG" && ! grep -q 'secret-batch-content' "$OCI_ARGS_LOG"; then
  ok "vault query key is secret-bundle-content"
else
  bad "vault query key contract"
fi
if grep -q -- '--secret-bundle-name careerpilot-postgres_password' "$OCI_ARGS_LOG"; then
  ok "vault bundle-name addressing"
else
  bad "vault bundle-name addressing"
fi
rm -rf "$ROOT/secrets/prod"

# ------------------------------------------------------------- health-check
echo "--- health-check.sh DRY_RUN (stub docker/df) ---"
cat > "$STUBBIN/docker" <<'EOF'
#!/usr/bin/env bash
# $DOCKER_MODE controls behavior: healthy | sick
if [ "${DOCKER_MODE:-healthy}" = "healthy" ]; then
  [ "$1" = "ps" ] && echo "careerpilot-backend-1 Up 1 minute (healthy)"
  exit 0
fi
if [ "$1" = "ps" ]; then
  echo "careerpilot-backend-1 Up 1 minute (unhealthy)"
  echo "careerpilot-worker-1 Up 2 minutes (healthy)"
elif [ "$1" = "exec" ]; then
  exit 1
fi
exit 0
EOF
cat > "$STUBBIN/df" <<'EOF'
#!/usr/bin/env bash
# $DF_PCT controls reported usage.
echo "Use%"
echo "${DF_PCT:-10}%"
EOF
chmod +x "$STUBBIN/docker" "$STUBBIN/df"

export BACKUP_DIR="$WORK/hc-backups"
mkdir -p "$BACKUP_DIR"
HC="$ROOT/ops/health-check.sh"

# Healthy: fresh backup, healthy containers, low disk.
touch "$BACKUP_DIR/careerpilot-fresh.dump.enc"
if DOCKER_MODE=healthy DF_PCT=10 DRY_RUN=1 COMPOSE_PROJECT=careerpilot \
    PATH="$STUBBIN:$PATH" bash "$HC" > "$WORK/hc-ok.log" 2>&1; then
  ok "health-check healthy exits 0"
  [ -s "$WORK/hc-ok.log" ] && bad "health-check healthy is silent" || ok "health-check healthy silent"
else
  bad "health-check healthy exits 0"
fi

# Sick: unhealthy container, full disk, dead postgres, no backup.
rm -f "$BACKUP_DIR"/careerpilot-*.dump.enc
if DOCKER_MODE=sick DF_PCT=95 DRY_RUN=1 COMPOSE_PROJECT=careerpilot \
    PATH="$STUBBIN:$PATH" bash "$HC" > "$WORK/hc-sick.log" 2>&1; then
  bad "health-check sick exits 1"
else
  ok "health-check sick exits 1"
fi
for code in unhealthy_containers disk_usage_95_pct postgresql_unreachable no_backup_artifact; do
  if grep -q "$code" "$WORK/hc-sick.log"; then ok "health-check alert $code"; else bad "health-check alert $code"; fi
done
if grep -q '"dry_run":true' "$WORK/hc-sick.log"; then ok "health-check dry-run envelope"; else bad "health-check dry-run envelope"; fi

# ------------------------------------------------------------------- backup
echo "--- backup.sh upload round-trip + retention + flock (stub pg_dump) ---"
cat > "$STUBBIN/pg_dump" <<'EOF'
#!/usr/bin/env bash
# Writes deterministic bytes to the -f target.
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "-f" ]; then out="$a"; fi
  prev="$a"
done
printf 'fake-dump-bytes-for-roundtrip' > "$out"
EOF
chmod +x "$STUBBIN/pg_dump"

export BACKUP_DIR="$WORK/backups"
mkdir -p "$BACKUP_DIR"
export STAGE="$WORK/stage"
mkdir -p "$STAGE"
printf '0123456789abcdef0123456789abcdef' > "$WORK/key.hex"
export BACKUP_ENCRYPTION_KEY_FILE="$WORK/key.hex"
export UPLOAD_CMD='xargs -I{} cp {} "$STAGE/"'
export DOWNLOAD_CMD='xargs -I{} cat "$STAGE/{}"'

# Stale artifact must be pruned by retention (RETENTION_DAYS=0 prunes all).
touch -d '100 days ago' "$BACKUP_DIR/careerpilot-20000101T000000Z-9.dump.enc"
if RETENTION_DAYS=0 PATH="$STUBBIN:$PATH" bash "$ROOT/ops/backup.sh" > "$WORK/backup.log" 2>&1; then
  ok "backup with upload round-trip exits 0"
else
  bad "backup with upload round-trip exits 0"
fi
[ -e "$BACKUP_DIR/careerpilot-20000101T000000Z-9.dump.enc" ] && bad "retention prunes stale" || ok "retention prunes stale"
if grep -q '"event":"backup_completed"' "$WORK/backup.log"; then ok "backup_completed telemetry"; else bad "backup_completed telemetry"; fi
if ls "$BACKUP_DIR"/careerpilot-*.dump.enc "$BACKUP_DIR"/careerpilot-*.dump.enc.sha256 >/dev/null 2>&1; then
  ok "artifact + manifest present"
else
  bad "artifact + manifest present"
fi

# Busy lock fails loudly instead of interleaving.
flock -n "$BACKUP_DIR/.backup.lock" sleep 30 &
HOLDER=$!
sleep 1
if kill -0 "$HOLDER" 2>/dev/null; then
  ok "lock holder present for contention probe"
else
  bad "lock holder present for contention probe"
fi
if RETENTION_DAYS=90 PATH="$STUBBIN:$PATH" bash "$ROOT/ops/backup.sh" > "$WORK/backup-lock.log" 2>&1; then
  bad "busy lock fails closed"
else
  ok "busy lock fails closed"
fi
grep -q '"stage":"lock_busy"' "$WORK/backup-lock.log" && ok "lock_busy telemetry" || { bad "lock_busy telemetry"; echo "--- backup-lock.log ---"; cat "$WORK/backup-lock.log"; }
kill "$HOLDER" 2>/dev/null || true
wait 2>/dev/null || true

echo "---"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
