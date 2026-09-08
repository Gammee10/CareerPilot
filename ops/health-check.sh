#!/usr/bin/env bash
# =============================================================================
# VM health check (T8.2, ADR-058). Run from cron on the OCI VM.
# Checks: containers healthy, disk threshold, PostgreSQL reachable, daily
# backup present and fresh, backend readyz, pg-boss queue depth. Failures
# produce ONE minimized alert through the
# Resend alert path (ADR-052 amended scope); alert content carries no user data.
#
# Env:
#   RESEND_API_KEY_FILE  (production; omit for DRY_RUN=1)
#   DRY_RUN=1            print the alert payload instead of sending
#   BACKUP_DIR           where backup.sh writes artifacts (default ./backups)
#   DISK_THRESHOLD_PCT   default 80
#   COMPOSE_PROJECT      compose project name (default careerpilot)
# =============================================================================
set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
DISK_THRESHOLD_PCT="${DISK_THRESHOLD_PCT:-80}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-careerpilot}"
MAX_BACKUP_AGE_HOURS=26

ALERTS=""

add_alert() { ALERTS="$ALERTS$1\n"; }

# 1. Container health.
# L8: match "(healthy)" exactly — a naive `healthy` substring also matches
# "(unhealthy)", silently dropping the containers that need alerting.
UNHEALTHY="$(docker ps --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
  --format '{{.Names}} {{.Status}}' | grep -v '(healthy)' || true)"
[ -n "$UNHEALTHY" ] && add_alert "unhealthy_containers: $UNHEALTHY"

# 2. Disk space.
USAGE="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
[ "${USAGE:-100}" -ge "$DISK_THRESHOLD_PCT" ] && add_alert "disk_usage_${USAGE}_pct"

# 3. PostgreSQL reachability (through the app's readyz is not enough on the
#    VM; check the container directly).
docker exec "${COMPOSE_PROJECT}-postgres-1" pg_isready -U careerpilot >/dev/null 2>&1 \
  || add_alert "postgresql_unreachable"

# 4. Daily backup success: newest artifact younger than 26h.
LATEST_BACKUP="$(ls -t "$BACKUP_DIR"/careerpilot-*.dump.enc 2>/dev/null | head -1 || true)"
if [ -z "$LATEST_BACKUP" ]; then
  add_alert "no_backup_artifact"
else
  AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$LATEST_BACKUP") ) / 3600 ))
  [ "$AGE_H" -gt "$MAX_BACKUP_AGE_HOURS" ] && add_alert "backup_stale_${AGE_H}h"
fi

# 5. O2: backend readyz (DB reachability THROUGH the app, not just the
#    container) — catches a live backend with a dead database handle.
docker exec "${COMPOSE_PROJECT}-backend-1" \
  wget -q -O /dev/null http://127.0.0.1:8080/api/readyz >/dev/null 2>&1 \
  || add_alert "backend_not_ready"

# 6. O2: pg-boss queue depth — a growing backlog means the worker is stuck
#    while every other check stays green. Threshold: 100 created jobs.
QUEUE_DEPTH="$(docker exec "${COMPOSE_PROJECT}-postgres-1" \
  psql -U careerpilot -d "${POSTGRES_DB:-careerpilot}" -tAc \
  "SELECT count(*) FROM pgboss.job WHERE state = 'created'" 2>/dev/null | tr -dc '0-9' || true)"
if [ -n "$QUEUE_DEPTH" ] && [ "$QUEUE_DEPTH" -gt 100 ]; then
  add_alert "queue_backlog_${QUEUE_DEPTH}"
fi

send_alert() {
  local SUBJECT="CareerPilot VM alert"
  local BODY="Checks failed:\n$ALERTS"
  if [ "${DRY_RUN:-0}" = "1" ]; then
    printf '{"dry_run":true,"alert_subject":"%s","alert_body":"%s"}\n' \
      "$SUBJECT" "$(printf '%b' "$BODY" | tr '\n' ';')"
    return 0
  fi
  local KEY_FILE="${RESEND_API_KEY_FILE:?set RESEND_API_KEY_FILE or DRY_RUN=1}"
  # H13: the API key never appears in a process argument vector (visible via
  # `ps`). It travels to curl in a 0600 config file, which is removed (and
  # the shell variable unset) before returning.
  local KEY CFG
  KEY="$(cat "$KEY_FILE")"
  CFG="$(mktemp)"
  chmod 600 "$CFG"
  printf 'header = "Authorization: Bearer %s"\n' "$KEY" > "$CFG"
  curl -s -X POST https://api.resend.com/emails \
    --config "$CFG" \
    -H "content-type: application/json" \
    -d "{\"from\":\"alerts@resend.dev\",\"to\":[\"${ALERT_RECIPIENT:?set ALERT_RECIPIENT}\"],\"subject\":\"$SUBJECT\",\"text\":\"$(printf '%b' "$BODY" | tr '\n' ';')\"}" \
    >/dev/null || true
  rm -f "$CFG"
  unset KEY
}

if [ -n "$ALERTS" ]; then
  send_alert
  exit 1
fi
exit 0
