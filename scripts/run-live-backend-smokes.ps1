param(
  [string]$ProjectRef = "xhusvkylbouwtpcevgri",
  [string]$EnvFile = ".env.edge.local"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$resolvedEnvFile = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $repositoryRoot $EnvFile }

if (-not (Test-Path -LiteralPath $resolvedEnvFile)) {
  throw "Local ignored env file not found: $resolvedEnvFile"
}

$variables = @{}
Get-Content -LiteralPath $resolvedEnvFile | ForEach-Object {
  if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') {
    $value = $matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $variables[$matches[1].Trim()] = $value
  }
}

$apiKeysJson = npx --yes supabase@latest projects api-keys --project-ref $ProjectRef -o json 2>$null | Out-String
if ($LASTEXITCODE -ne 0) { throw "Could not obtain current Supabase API keys through the authenticated CLI session." }
$apiKeys = $apiKeysJson | ConvertFrom-Json
$serviceRole = $apiKeys | Where-Object { $_.name -eq "service_role" -and $_.type -eq "legacy" } | Select-Object -First 1
$anon = $apiKeys | Where-Object { $_.name -eq "anon" -and $_.type -eq "legacy" } | Select-Object -First 1

if (-not $serviceRole.api_key -or -not $anon.api_key) { throw "The project did not return the required legacy API keys." }
if (-not $variables["SUPABASE_URL"] -or -not $variables["STRIPE_SECRET_KEY"]) { throw "SUPABASE_URL and STRIPE_SECRET_KEY are required in the ignored env file." }

$env:SUPABASE_URL = $variables["SUPABASE_URL"]
$env:SUPABASE_SERVICE_ROLE_KEY = $serviceRole.api_key
$env:SUPABASE_PUBLIC_KEY = $anon.api_key
$env:STRIPE_SECRET_KEY = $variables["STRIPE_SECRET_KEY"]

Push-Location $repositoryRoot
try {
  node scripts/smoke-live-backend.mjs
  if ($LASTEXITCODE -ne 0) { throw "Commerce/backend live smoke failed." }
  node scripts/smoke-live-admin.mjs
  if ($LASTEXITCODE -ne 0) { throw "Admin/RLS live smoke failed." }
  Write-Output "LIVE_BACKEND_AND_ADMIN_SMOKES=passed"
} finally {
  Pop-Location
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:SUPABASE_PUBLIC_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:STRIPE_SECRET_KEY -ErrorAction SilentlyContinue
}
