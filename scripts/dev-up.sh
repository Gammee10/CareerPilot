# One-command local dev startup (T1.4).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

if [ ! -f secrets/local/postgres_password.txt ]; then
  bash scripts/dev-secrets.sh
fi

docker compose up -d --build --wait

echo ""
echo "CareerPilot stack is healthy:"
echo "  Dashboard (via Caddy):   http://localhost:8080"
echo "  Backend API (via Caddy): http://localhost:8080/api/healthz"
echo "  Direct debug binds are localhost-only (see compose.override.yaml)."
