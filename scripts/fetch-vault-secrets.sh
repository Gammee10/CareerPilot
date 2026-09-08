#!/usr/bin/env bash
# =============================================================================
# PRODUCTION SECRETS RETRIEVAL PROCEDURE — run ONLY on the approved OCI VM.
# Local development must use scripts/dev-secrets.ps1 / .sh instead.
#
# Implements ADR-056: OCI Vault is the source of truth; secrets are written to
# files on the VM and injected into containers only as file-mounted Compose
# secrets. Values never enter environment variables, images, or git.
#
# Prerequisites (documented, not assumed):
#   - OCI CLI configured with an instance principal or user profile whose
#     identity policy grants read ONLY on the `careerpilot-*` secret bundles
#     in the approved compartment (capability-scoped per ADR-028).
#   - The five `careerpilot-<name>` secret bundles provisioned in the vault
#     ahead of deploy time.
#
# This script is a procedure template: the operator provisions
# `careerpilot-<name>` secret bundles in the vault ahead of deploy time. It
# writes each secret to secrets/prod/<name>.txt (mode 600), matching the
# filenames in compose.yaml.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/secrets/prod"
mkdir -p "$OUT"
chmod 700 "$OUT"

SECRET_NAMES=(postgres_password session_signing_key resend_api_key gemini_api_key ai_internal_token)

for name in "${SECRET_NAMES[@]}"; do
  # L8: verified OCI data-plane syntax. `oci secrets secret-bundle get`
  # addresses a bundle by NAME (no compartment/vault flags on this call);
  # the payload lives at data."secret-bundle-content".content (base64).
  base64_secret="$(oci secrets secret-bundle get \
    --auth instance_principal \
    --secret-bundle-name "careerpilot-${name}" \
    --query 'data."secret-bundle-content".content' \
    --raw-output)"
  printf '%s' "$base64_secret" | base64 -d > "$OUT/$name.txt"
  chmod 600 "$OUT/$name.txt"
  echo "retrieved: $name (value not displayed)"
done

echo "Production secrets staged in $OUT."
echo "Deploy with: CAREERPILOT_SECRET_DIR=$OUT docker compose up -d --wait"
