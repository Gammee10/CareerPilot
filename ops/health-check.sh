#!/usr/bin/env bash
# =============================================================================
# VM health check (T8.2, ADR-058). Run from cron on the OCI VM.
# Checks: containers healthy, disk threshold, PostgreSQL reachable, daily
# backup present and fresh. Failures produce ONE minimized alert through the
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
UNHEALTHY="$(docker ps --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
  --format '{{.Names}} {{.Status}}' | grep -v healthy || true)"
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

send_alert() {
  local SUBJECT="CareerPilot VM alert"
  local BODY="Checks failed:\n$ALERTS"
  if [ "${DRY_RUN:-0}" = "1" ]; then
    printf '{"dry_run":true,"alert_subject":"%s","alert_body":"%s"}\n' \
      "$SUBJECT" "$(printf '%b' "$BODY" | tr '\n' ';')"
    return 0
  fi
  local KEY_FILE="${RESEND_API_KEY_FILE:?set RESEND_API_KEY_FILE or DRY_RUN=1}"
  local KEY; KEY="$(cat "$KEY_FILE")"
  curl -s -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $KEY" \
    -H "content-type: application/json" \
    -d "{\"from\":\"alerts@resend.dev\",\"to\":[\"${ALERT_RECIPIENT:?set ALERT_RECIPIENT}\"],\"subject\":\"$SUBJECT\",\"text\":\"$(printf '%b' "$BODY" | tr '\n' ';')\"}" \
    >/dev/null || true
}

if [ -n "$ALERTS" ]; then
  send_alert
  exit 1
fi
exit 0
