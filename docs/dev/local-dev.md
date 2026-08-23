# Local Development Environment

## One command

```powershell
# Windows PowerShell
powershell -File scripts/dev-up.ps1
```

```bash
# Linux/macOS/WSL
bash scripts/dev-up.sh
```

The script is idempotent and safe on a fresh clone:

1. Creates `.env` from `.env.example` if missing.
2. Generates clearly-marked **local-only** secrets into `secrets/local/` if missing
   (`scripts/dev-secrets.ps1` / `.sh`). These are git-ignored placeholders.
3. Runs `docker compose up -d --build --wait` — migrations apply automatically
   via a one-shot `migrate` service before backend/worker start.

## Resulting stack (healthy when `--wait` returns)

| Service  | Purpose                          | Public?                              |
|----------|----------------------------------|--------------------------------------|
| caddy    | Sole public HTTPS/HTTP proxy     | Yes (`:80`; dev bind `127.0.0.1:8080`) |
| frontend | Next.js dashboard                | Via Caddy only                       |
| backend  | Express authoritative API        | Via Caddy `/api/*` only              |
| worker   | Node background runtime role     | No                                   |
| ai       | FastAPI internal AI capability   | No                                   |
| postgres | System of record                 | No                                   |

Local debug binds (localhost-only, dev override file): dashboard
http://localhost:3000, backend http://localhost:8081,
postgres `127.0.0.1:5433`, entry point http://localhost:8080.

Useful checks after startup:

```powershell
docker compose ps                     # all services healthy
curl http://localhost:8080/api/healthz    # backend liveness via Caddy
curl http://localhost:8080/api/readyz     # backend + PostgreSQL readiness
```

## Schema tests (T1.2 evidence)

```powershell
powershell -File scripts/test-schema.ps1
```

Applies all migrations to a disposable PostgreSQL container and asserts:
append-only tables reject UPDATE/DELETE; retention-sweep deletes work only
when explicitly marked; lifecycle/governance check constraints hold;
one-active-discovery-run per user; observation idempotency guard.

## Teardown

```powershell
docker compose down            # stop (keeps volumes)
docker compose down -v         # stop and delete PostgreSQL data volume
```
