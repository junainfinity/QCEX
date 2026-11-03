$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
foreach ($line in Get-Content -LiteralPath (Join-Path $repoRoot '.env')) {
  if ($line -match '^([A-Z_]+)=(.+)$') { [Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process') }
}
Set-Location $repoRoot
$env:DATABASE_URL='jdbc:mysql://127.0.0.1:3308/qcex'
$env:DATABASE_USER='qcex'
& '.\.tools\apache-maven-3.9.16\bin\mvn.cmd' -f services/exchange/pom.xml spring-boot:run -q
exit $LASTEXITCODE
