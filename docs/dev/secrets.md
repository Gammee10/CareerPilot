# Secrets Wiring (T1.3)

Implements ADR-056 (OCI Vault + per-container Compose secrets) and ADR-028
(capability-scoped credential governance).

## Pattern

1. **Source of truth**: OCI Vault in production; clearly-marked generated
   placeholders in local development (`scripts/dev-secrets.*`).
2. **Retrieval**: `scripts/fetch-vault-secrets.sh` (production, VM-only) pulls
   each secret from the approved vault and writes it to `secrets/prod/<name>.txt`
   (mode 600). The script never prints values.
3. **Injection**: `compose.yaml` declares top-level `secrets:` whose `file:`
   paths resolve through `CAREERPILOT_SECRET_DIR` (set via `.env`; production
   deployment sets it to the Vault-populated directory).
4. **Consumption**: each container reads its secret from `/run/secrets/<name>`
   at startup (`apps/backend/src/config.ts`). The PostgreSQL image reads
   `POSTGRES_PASSWORD_FILE` natively.

## Hard rules

- No secret value is ever stored in an environment variable — only file mounts.
- No secret is committed (`secrets/*` git-ignored except README), baked into
  images, or logged.
- Capability scoping matrix: see `secrets/README.md`. Frontend gets nothing;
  FastAPI only the Gemini key; worker only the database password.

## Verification performed this phase

- Grep-based check across the repo finds no secret material in code/config
  (local dev secrets are random per-machine files inside the ignored
  `secrets/local/` directory).
- Containers demonstrably read mounted secret files: PostgreSQL initializes
  from `POSTGRES_PASSWORD_FILE` and backend authenticates using the same
  mounted value (`/readyz` returns ready) while no password exists in any env.

## Adding a new capability-scoped secret later

1. Add the name to `secrets/README.md` matrix and to the Vault retrieval list.
2. Add a top-level `secrets:` entry in `compose.yaml`.
3. Mount it on exactly the services that require it.
4. Read it via `readSecret()`-style file access; never via env vars.
