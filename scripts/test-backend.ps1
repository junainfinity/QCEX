$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
foreach ($line in Get-Content -LiteralPath '.env') {
  if ($line -match '^([A-Z_]+)=(.+)$') { [Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process') }
}
Get-Content -Raw -LiteralPath 'scripts/test-database.sql' | docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot'
if ($LASTEXITCODE -ne 0) { throw 'Test database setup failed' }
$env:QCEX_MYSQL_TESTS='true'
& '.\.tools\apache-maven-3.9.16\bin\mvn.cmd' -f services/exchange/pom.xml test -q
exit $LASTEXITCODE
