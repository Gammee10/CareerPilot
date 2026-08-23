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
#     identity policy grants read ONLY on the careerpilot secret family in
#     the approved vault (capability-scoped per ADR-028).
#   - Vault OCID and compartment OCID provisioned by the operator.
#
# This script is a procedure template: the operator supplies the vault/secret
# OCIDs at deploy time via environment variables. It writes each secret to
# secrets/prod/<name>.txt (mode 600), matching the filenames in compose.yaml.
# =============================================================================
set -euo pipefail

: "${CAREERPILOT_COMPARTMENT_OCID:?set CAREERPILOT_COMPARTMENT_OCID}"
: "${CAREERPILOT_VAULT_OCID:?set CAREERPILOT_VAULT_OCID}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/secrets/prod"
mkdir -p "$OUT"
chmod 700 "$OUT"

SECRET_NAMES=(postgres_password session_signing_key resend_api_key gemini_api_key)

for name in "${SECRET_NAMES[@]}"; do
  base64_secret="$(oci secrets secret-bundle get \
    --auth instance_principal \
    --compartment-id "$CAREERPILOT_COMPARTMENT_OCID" \
    --vault-id "$CAREERPILOT_VAULT_OCID" \
    --secret-name "careerpilot-${name}" \
    --query 'data."secret-batch-content".content' \
    --raw-output)"
  printf '%s' "$base64_secret" | base64 -d > "$OUT/$name.txt"
  chmod 600 "$OUT/$name.txt"
  echo "retrieved: $name (value not displayed)"
done

echo "Production secrets staged in $OUT."
echo "Deploy with: CAREERPILOT_SECRET_DIR=$OUT docker compose up -d --wait"
