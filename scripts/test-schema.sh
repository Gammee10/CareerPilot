#!/usr/bin/env bash
# T1.2 acceptance evidence: applies migrations to a disposable PostgreSQL
# container and runs the schema test suite (append-only, constraints,
# coalescing, idempotency). No project state is touched.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CID="careerpilot-schema-test-$$"
cleanup() { docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$CID" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=careerpilot \
  postgres:17-alpine >/dev/null
# Wait for the STABLE server (the image's temporary initdb server shuts down).
ready=0
for _ in $(seq 1 60); do
  if echo "SELECT 1;" | docker exec -i "$CID" psql -U postgres -d careerpilot -q >/dev/null 2>&1; then
    sleep 1
    if echo "SELECT 1;" | docker exec -i "$CID" psql -U postgres -d careerpilot -q >/dev/null 2>&1; then
      ready=1; break
    fi
  fi
  sleep 1
done
[ "$ready" = "1" ] || { echo "postgres test container never became ready"; exit 1; }

echo "== Applying migrations =="
for f in db/migrations/*.sql; do
  echo "-- $f"
  docker exec -i "$CID" psql -v ON_ERROR_STOP=1 -U postgres -d careerpilot -q < "$f"
done

echo "== Running schema tests =="
docker exec -i "$CID" psql -v ON_ERROR_STOP=1 -U postgres -d careerpilot \
  -f /dev/stdin < db/tests/schema-tests.sql

echo ""
echo "SCHEMA TESTS: PASS (T1.2 acceptance criteria demonstrated)"
