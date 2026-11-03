param([Parameter(Mandatory=$true)][string]$BackupFile)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
$recoveryDb = 'qcex_recovery_' + (Get-Date -Format 'yyyyMMddHHmmss')
"CREATE DATABASE $recoveryDb;" | docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot'
if ($LASTEXITCODE -ne 0) { throw 'Recovery database creation failed' }
Get-Content -Raw -LiteralPath $BackupFile | docker compose exec -T mysql sh -c ('MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot ' + $recoveryDb)
if ($LASTEXITCODE -ne 0) { throw 'Restore failed' }
$verification = @"
SELECT COUNT(*) AS imbalance_count FROM (SELECT journal_id,asset FROM postings GROUP BY journal_id,asset HAVING SUM(amount)<>0) breaks;
SELECT COUNT(*) AS projection_mismatch_count FROM balances b LEFT JOIN (SELECT owner_id,wallet,asset,SUM(CASE WHEN bucket='available' THEN amount ELSE 0 END) a,SUM(CASE WHEN bucket='held' THEN amount ELSE 0 END) h FROM postings GROUP BY owner_id,wallet,asset) p ON b.owner_id=p.owner_id AND b.wallet=p.wallet AND b.asset=p.asset WHERE b.available<>COALESCE(p.a,0) OR b.held<>COALESCE(p.h,0);
SELECT COUNT(*) AS journal_count FROM journal;
SELECT COUNT(*) AS order_count FROM orders;
SELECT COUNT(*) AS fill_count FROM fills;
"@
$values = $verification | docker compose exec -T mysql sh -c ('MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N ' + $recoveryDb)
if ($LASTEXITCODE -ne 0) { throw 'Recovery verification failed' }
if ([int]$values[0] -ne 0 -or [int]$values[1] -ne 0) { throw 'Restored state does not reconcile' }
$result=@{database=$recoveryDb;imbalancedJournals=[int]$values[0];projectionMismatches=[int]$values[1];journals=[int]$values[2];orders=[int]$values[3];fills=[int]$values[4];liveDatabaseModified=$false;scope='Same-host isolated-schema restore; not off-host disaster recovery'}
$result | ConvertTo-Json | Set-Content -LiteralPath 'artifacts/restore-result.json'
$result | ConvertTo-Json
