param([string]$OutputFile)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
if (-not $OutputFile) { $OutputFile=Join-Path $repoRoot ("artifacts/backups/qcex-"+(Get-Date -Format 'yyyyMMdd-HHmmss')+".sql") }
$resolved = [IO.Path]::GetFullPath($OutputFile)
New-Item -ItemType Directory -Path (Split-Path -Parent $resolved) -Force | Out-Null
$dump = docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysqldump -uqcex --single-transaction --skip-lock-tables --no-tablespaces --set-gtid-purged=OFF qcex'
if ($LASTEXITCODE -ne 0) { throw 'Database backup failed' }
[IO.File]::WriteAllLines($resolved,$dump,[Text.UTF8Encoding]::new($false))
Get-FileHash -LiteralPath $resolved -Algorithm SHA256 | Select-Object Path,Hash
