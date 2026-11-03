$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $repoRoot '.tools'
$version = '3.9.16'
$destination = Join-Path $toolsDir "apache-maven-$version"
if (-not (Test-Path -LiteralPath $destination)) {
  New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
  $archive = Join-Path $toolsDir "apache-maven-$version-bin.zip"
  $source = "https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/$version/apache-maven-$version-bin.zip"
  Invoke-WebRequest -Uri $source -OutFile $archive
  $expected = (Invoke-WebRequest -Uri "$source.sha512").Content.Trim().Split(' ')[0]
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA512).Hash.ToLowerInvariant() -ne $expected.ToLowerInvariant()) { throw 'Maven checksum mismatch' }
  Expand-Archive -LiteralPath $archive -DestinationPath $toolsDir
}
$envFile = Join-Path $repoRoot '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
  $dbPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  $rootPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  [IO.File]::WriteAllText($envFile, "DATABASE_PASSWORD=$dbPassword`nMYSQL_ROOT_PASSWORD=$rootPassword`n")
}
Write-Output "Portable Maven $version and local environment ready."
