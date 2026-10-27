# Stores falcondeck-staging's transaction-pooler connection in the git-ignored
# .env.staging-pooler.local as FALCON_TEST_DATABASE_URL, for
# `npm run verify:onboarding-setup-pooler`.
#
# Prompts for the database password with masked input. Never prints the
# password or the completed connection string. Refuses to write anything
# unless git confirms the file is ignored and not tracked.
#
# Run from any directory:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\set-staging-pooler-url.ps1

$ErrorActionPreference = 'Stop'

$PoolerHost = 'aws-0-us-east-2.pooler.supabase.com'
$PoolerPort = 6543
$Database = 'postgres'
$User = 'postgres.fkqplulzwchunhthyoym'
$FileName = '.env.staging-pooler.local'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot
$target = Join-Path $repoRoot $FileName

# 1. The file must be git-ignored and untracked before anything is written.
& git check-ignore -q -- $FileName
if ($LASTEXITCODE -ne 0) {
    Write-Error "$FileName is not git-ignored in $repoRoot. Nothing was written."
    exit 1
}
# No --error-unmatch: under Windows PowerShell 5.1 its stderr becomes a
# terminating error. An untracked file simply produces no output.
$tracked = & git ls-files -- $FileName
if ($LASTEXITCODE -ne 0) {
    Write-Error "git ls-files failed (exit $LASTEXITCODE). Nothing was written."
    exit 1
}
if ($tracked | Where-Object { $_ -eq $FileName }) {
    Write-Error "$FileName is tracked by git. Nothing was written."
    exit 1
}
Write-Host "OK: $FileName is git-ignored and untracked."

if (Test-Path $target) {
    $answer = Read-Host "$FileName already exists. Overwrite it? (y/N)"
    if ($answer -notmatch '^[yY]$') {
        Write-Host 'Left unchanged.'
        exit 0
    }
}

# 2. Masked password prompt.
Write-Host "Staging target: $User@${PoolerHost}:$PoolerPort/$Database"
$secure = Read-Host 'falcondeck-staging database password' -AsSecureString
if ($secure.Length -eq 0) {
    Write-Error 'No password entered. Nothing was written.'
    exit 1
}

# 3. URL-encode and write, keeping the plain text only as long as needed.
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $encoded = [Uri]::EscapeDataString([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr))
    $line = "FALCON_TEST_DATABASE_URL=postgresql://${User}:$encoded@${PoolerHost}:$PoolerPort/$Database"
    [IO.File]::WriteAllText($target, $line, [Text.Encoding]::ASCII)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    Remove-Variable encoded, line, secure, bstr -ErrorAction SilentlyContinue
}

# 4. Re-check after writing, and report without the secret.
& git check-ignore -q -- $FileName
if ($LASTEXITCODE -ne 0) {
    Remove-Item $target -Force
    Write-Error "$FileName stopped being git-ignored; the file was deleted."
    exit 1
}
$status = & git status --porcelain --ignored=no -- $FileName
if ($status) {
    Remove-Item $target -Force
    Write-Error "git reports $FileName as a change; the file was deleted."
    exit 1
}
Write-Host "Saved FALCON_TEST_DATABASE_URL for $User@${PoolerHost}:$PoolerPort/$Database to $FileName (git-ignored)."
