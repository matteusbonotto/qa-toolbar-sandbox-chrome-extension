param([string]$EnvFile = ".env.private")
$ErrorActionPreference = "Stop"

if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $name, $value = $line -split '=', 2
    [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim().Trim('"'), 'Process')
  }
}

$url = $env:SUPABASE_URL
$secret = $env:SUPABASE_SECRET_KEY
if (-not $url -or -not $secret) { throw "Configure SUPABASE_URL e SUPABASE_SECRET_KEY somente em .env.private." }

$definitions = @(
  @{ Env = 'QTS_VOUCHER_MBLABS_CODE'; Label = 'MBLABS Full Access'; Days = 365 },
  @{ Env = 'QTS_VOUCHER_CNKLT_CODE'; Label = 'CNKLT Full Access'; Days = 365 },
  @{ Env = 'QTS_VOUCHER_ONO_CODE'; Label = 'ONO Founder Full Access'; Days = $null }
)

foreach ($definition in $definitions) {
  $code = [Environment]::GetEnvironmentVariable($definition.Env, 'Process')
  if (-not $code) { throw "Configure $($definition.Env) em .env.private." }
  $bytes = [Text.Encoding]::UTF8.GetBytes($code.Trim().ToUpperInvariant())
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { $hash = ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $algorithm.Dispose() }
  $body = @{ voucher_hash = $hash; voucher_label = $definition.Label; voucher_grant_days = $definition.Days; voucher_expires_at = $null } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "$url/rest/v1/rpc/provision_voucher" -UserAgent 'qts-voucher-provisioner/1.0' -Headers @{ apikey=$secret; Authorization="Bearer $secret" } -ContentType 'application/json' -Body $body | Out-Null
  Write-Host "Provisioned $($definition.Label) without storing its code in the repository."
}
