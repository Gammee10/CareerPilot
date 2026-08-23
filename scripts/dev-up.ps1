# One-command local dev startup (T1.4).
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Output "Created .env from .env.example"
}

if (-not (Test-Path "secrets\local\postgres_password.txt")) {
  & (Join-Path $PSScriptRoot "dev-secrets.ps1")
}

docker compose up -d --build --wait
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

Write-Output ""
Write-Output "CareerPilot stack is healthy:"
Write-Output "  Dashboard (via Caddy):   http://localhost:8080"
Write-Output "  Backend API (via Caddy): http://localhost:8080/api/healthz"
Write-Output "  Direct debug binds are localhost-only (see compose.override.yaml)."
