# T1.2 acceptance evidence: applies migrations to a disposable PostgreSQL
# container and runs the schema test suite (append-only, constraints,
# coalescing, idempotency). No project state is touched.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$cid = "careerpilot-schema-test-" + (Get-Random)
docker run -d --name $cid -e POSTGRES_PASSWORD=test -e POSTGRES_DB=careerpilot postgres:17-alpine | Out-Null
try {
  # Wait for the STABLE server: the postgres image starts a temporary server
  # during initdb that then shuts down, so require two consecutive successes.
  # (Native stderr redirects throw under Stop preference in PS 5.1, so relax
  # the preference for this loop only.)
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $ready = $false
    foreach ($i in 1..60) {
      $ok1 = $false; $ok2 = $false
      $null = docker exec $cid psql -U postgres -d careerpilot -q -tAc "SELECT 1" 2>&1
      if ($LASTEXITCODE -eq 0) {
        $ok1 = $true
        Start-Sleep -Seconds 1
        $null = docker exec $cid psql -U postgres -d careerpilot -q -tAc "SELECT 1" 2>&1
        $ok2 = ($LASTEXITCODE -eq 0)
      }
      if ($ok1 -and $ok2) { $ready = $true; break }
      Start-Sleep -Seconds 1
    }
  } finally {
    $ErrorActionPreference = $prevEap
  }
  if (-not $ready) { throw "postgres test container never became ready" }

  Write-Output "== Applying migrations =="
  Get-ChildItem "$root\db\migrations\*.sql" | Sort-Object Name | ForEach-Object {
    Write-Output "-- $($_.Name)"
    Get-Content $_.FullName -Raw | docker exec -i $cid psql -v ON_ERROR_STOP=1 -U postgres -d careerpilot -q
    if ($LASTEXITCODE -ne 0) { throw "migration failed: $($_.Name)" }
  }

  Write-Output "== Running schema tests =="
  $tests = Get-Content "$root\db\tests\schema-tests.sql" -Raw
  $tests | docker exec -i $cid psql -v ON_ERROR_STOP=1 -U postgres -d careerpilot
  if ($LASTEXITCODE -ne 0) { throw "schema tests failed" }

  Write-Output ""
  Write-Output "SCHEMA TESTS: PASS (T1.2 acceptance criteria demonstrated)"
} finally {
  docker rm -f $cid 2>$null | Out-Null
}
