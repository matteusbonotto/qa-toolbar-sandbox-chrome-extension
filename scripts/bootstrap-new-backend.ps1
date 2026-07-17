[CmdletBinding()]
param(
  [string]$ProjectRef,

  [string]$SecretsFile = '.env.edge.local',

  [switch]$SkipSchema
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$secretsPath = (Resolve-Path (Join-Path $workspace $SecretsFile)).Path

if (-not $secretsPath.StartsWith($workspace, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'SecretsFile must be inside this repository.'
}

$requiredSecretNames = @(
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'CHECKOUT_SUCCESS_URL',
  'CHECKOUT_CANCEL_URL',
  'CHROME_WEB_STORE_URL',
  'KEEP_ALIVE_SECRET',
  'ALLOWED_ORIGINS',
  'ALLOWED_EXTENSION_IDS'
)
$configuredNames = Get-Content -LiteralPath $secretsPath |
  Where-Object { $_ -match '^\s*[A-Z][A-Z0-9_]*\s*=' } |
  ForEach-Object { ($_ -split '=', 2)[0].Trim() }
$configuredValues = @{}
Get-Content -LiteralPath $secretsPath |
  Where-Object { $_ -match '^\s*[A-Z][A-Z0-9_]*\s*=' } |
  ForEach-Object {
    $parts = $_ -split '=', 2
    $configuredValues[$parts[0].Trim()] = $parts[1].Trim()
  }
foreach ($candidateName in @('.env.local', '.env.private', '.env')) {
  $candidatePath = Join-Path $workspace $candidateName
  if (-not (Test-Path -LiteralPath $candidatePath)) { continue }
  Get-Content -LiteralPath $candidatePath |
    Where-Object { $_ -match '^\s*(SUPABASE_URL|VITE_SUPABASE_URL|SUPABASE_PROJECT_REF|VITE_SUPABASE_PROJECT_REF)\s*=' } |
    ForEach-Object {
      $parts = $_ -split '=', 2
      if (-not $configuredValues[$parts[0].Trim()]) {
        $configuredValues[$parts[0].Trim()] = $parts[1].Trim()
      }
    }
}

if (-not $ProjectRef) {
  $projectRefCandidates = @(
    $configuredValues['VITE_SUPABASE_PROJECT_REF'],
    $configuredValues['SUPABASE_PROJECT_REF']
  ) | Where-Object { $_ -match '^[a-z0-9]{20}$' }
  foreach ($urlName in @('SUPABASE_URL', 'VITE_SUPABASE_URL')) {
    $configuredUrl = $configuredValues[$urlName]
    if ($configuredUrl -match '^https://([a-z0-9]{20})\.supabase\.co/?$') {
      $projectRefCandidates += $Matches[1]
    }
  }
  $linkedRefPath = Join-Path $workspace 'supabase\.temp\project-ref'
  if (Test-Path -LiteralPath $linkedRefPath) {
    $linkedRef = (Get-Content -Raw -LiteralPath $linkedRefPath).Trim()
    if ($linkedRef -match '^[a-z0-9]{20}$') { $projectRefCandidates += $linkedRef }
  }
  $ProjectRef = $projectRefCandidates | Select-Object -First 1
}
if ($ProjectRef -and $ProjectRef -notmatch '^[a-z0-9]{20}$') {
  throw 'ProjectRef invalido: use o Reference ID de 20 caracteres do Supabase.'
}
if (-not $ProjectRef) {
  throw @'
ProjectRef nao foi encontrado automaticamente.
Ele e o identificador de 20 caracteres do projeto Supabase, disponivel em:
  Dashboard > Project Settings > General > Reference ID
ou na URL:
  https://supabase.com/dashboard/project/SEU_PROJECT_REF

Depois execute novamente com:
  npm run backend:bootstrap -- -ProjectRef SEU_PROJECT_REF

Se o projeto novo ainda nao existe, crie-o primeiro em https://database.new.
'@
}
$stripeCatalogJson = (& node scripts/bootstrap-stripe-catalog.mjs --env-file $secretsPath --archive-legacy) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'Stripe catalog bootstrap failed.' }
$stripeCatalogValues = $stripeCatalogJson | ConvertFrom-Json
$stripeCatalogValues.PSObject.Properties | ForEach-Object { $configuredValues[$_.Name] = [string]$_.Value }

& powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-stripe-webhook.ps1 `
  -SecretsFile $secretsPath `
  -ProjectRef $ProjectRef | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Stripe webhook bootstrap failed.' }
$webhookLine = Get-Content -LiteralPath $secretsPath | Where-Object { $_ -match '^STRIPE_WEBHOOK_SECRET=' } | Select-Object -First 1
if ($webhookLine) { $configuredValues['STRIPE_WEBHOOK_SECRET'] = ($webhookLine -split '=', 2)[1].Trim() }

$missingNames = $requiredSecretNames | Where-Object { -not $configuredValues[$_] }
if ($missingNames.Count -gt 0) {
  throw "Missing required entries in $SecretsFile`: $($missingNames -join ', ')"
}

$priceCatalog = @(
  @{ Plan = 'regression-runner'; Cycle = 'monthly'; Amount = 1900; Names = @('STRIPE_REGRESSION_RUNNER_MONTHLY_PRICE_ID') },
  @{ Plan = 'regression-runner'; Cycle = 'yearly'; Amount = 18200; Names = @('STRIPE_REGRESSION_RUNNER_YEARLY_PRICE_ID') },
  @{ Plan = 'root-cause-analyst'; Cycle = 'monthly'; Amount = 3900; Names = @('STRIPE_ROOT_CAUSE_ANALYST_MONTHLY_PRICE_ID', 'STRIPE_PRO_MONTHLY_PRICE_ID') },
  @{ Plan = 'root-cause-analyst'; Cycle = 'yearly'; Amount = 37400; Names = @('STRIPE_ROOT_CAUSE_ANALYST_YEARLY_PRICE_ID', 'STRIPE_PRO_YEARLY_PRICE_ID') },
  @{ Plan = 'release-manager'; Cycle = 'monthly'; Amount = 6900; Names = @('STRIPE_RELEASE_MANAGER_MONTHLY_PRICE_ID', 'STRIPE_SCALE_MONTHLY_PRICE_ID') },
  @{ Plan = 'release-manager'; Cycle = 'yearly'; Amount = 66200; Names = @('STRIPE_RELEASE_MANAGER_YEARLY_PRICE_ID', 'STRIPE_SCALE_YEARLY_PRICE_ID') }
)
foreach ($entry in $priceCatalog) {
  $entry.PriceId = $entry.Names | ForEach-Object { $configuredValues[$_] } | Where-Object { $_ } | Select-Object -First 1
  if ($entry.PriceId -notmatch '^price_[A-Za-z0-9]+$') {
    throw "Missing valid Stripe price for $($entry.Plan)/$($entry.Cycle). Configure one of: $($entry.Names -join ', ')"
  }
}
Push-Location $workspace
$runtimeSecretsPath = [IO.Path]::GetTempFileName()
try {
  & npx --yes supabase@latest link --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { throw 'Supabase project link failed.' }

  & npx --yes supabase@latest config push --project-ref $ProjectRef --yes
  if ($LASTEXITCODE -ne 0) { throw 'Supabase Auth / Edge Function configuration push failed.' }

  if (-not $SkipSchema) {
    & npx --yes supabase@latest db push --linked --include-all --yes
    if ($LASTEXITCODE -ne 0) { throw 'Supabase database migration failed.' }
  }

  $apiKeyJson = (& npx --yes supabase@latest projects api-keys --project-ref $ProjectRef --reveal --output json 2>$null) -join "`n"
  $projectKeys = $apiKeyJson | ConvertFrom-Json
  $publicKey = ($projectKeys | Where-Object { $_.type -eq 'publishable' -and $_.name -eq 'default' } | Select-Object -First 1).api_key
  if (-not $publicKey) { $publicKey = ($projectKeys | Where-Object { $_.name -eq 'anon' } | Select-Object -First 1).api_key }
  if (-not $publicKey) { throw 'Could not obtain a browser-safe public key for the linked Supabase project.' }
  $serverKey = ($projectKeys | Where-Object { $_.name -eq 'service_role' } | Select-Object -First 1).api_key
  if (-not $serverKey) { $serverKey = ($projectKeys | Where-Object { $_.type -eq 'secret' } | Select-Object -First 1).api_key }
  if (-not $serverKey) { throw 'Could not obtain a server-side key for the linked Supabase project.' }

  $localPublicValues = [ordered]@{
    'SUPABASE_PROJECT_REF' = $ProjectRef
    'SUPABASE_URL' = "https://$ProjectRef.supabase.co"
    'APP_SUPABASE_PUBLIC_KEY' = $publicKey
    'VITE_SUPABASE_URL' = "https://$ProjectRef.supabase.co"
    'VITE_SUPABASE_PUBLISHABLE_KEY' = $publicKey
  }
  $localSecretsContent = Get-Content -Raw -LiteralPath $secretsPath
  foreach ($entry in $localPublicValues.GetEnumerator()) {
    $line = "$($entry.Key)=$($entry.Value)"
    if ($localSecretsContent -match "(?m)^$([regex]::Escape($entry.Key))=.*$") {
      $localSecretsContent = [regex]::Replace($localSecretsContent, "(?m)^$([regex]::Escape($entry.Key))=.*$", $line)
    } else {
      $localSecretsContent = "$($localSecretsContent.TrimEnd())`r`n$line`r`n"
    }
    $configuredValues[$entry.Key] = [string]$entry.Value
  }
  Set-Content -LiteralPath $secretsPath -Value $localSecretsContent -Encoding utf8 -NoNewline

  Get-Content -LiteralPath $secretsPath |
    Where-Object { $_ -notmatch '^\s*(SUPABASE_|VITE_|APP_SUPABASE_)' } |
    Set-Content -LiteralPath $runtimeSecretsPath -Encoding utf8
  & npx --yes supabase@latest secrets set --project-ref $ProjectRef --env-file $runtimeSecretsPath
  if ($LASTEXITCODE -ne 0) { throw 'Supabase secrets upload failed.' }

  $rpcUrl = "https://$ProjectRef.supabase.co/rest/v1/rpc/configure_stripe_price"
  $rpcHeaders = @{ apikey = $serverKey; 'Content-Type' = 'application/json' }
  if (-not $serverKey.StartsWith('sb_secret_')) {
    $rpcHeaders.Authorization = "Bearer $serverKey"
  }
  foreach ($entry in $priceCatalog) {
    $body = @{
      plan_key_input = $entry.Plan
      billing_cycle_input = $entry.Cycle
      provider_price_id_input = $entry.PriceId
      amount_minor_input = $entry.Amount
    } | ConvertTo-Json -Compress
    try {
      Invoke-RestMethod -Method Post -Uri $rpcUrl -Headers $rpcHeaders -Body $body | Out-Null
    } catch {
      throw "Stripe price configuration failed for $($entry.Plan)/$($entry.Cycle): $($_.Exception.Message)"
    }
  }

  & npx --yes supabase@latest functions deploy --project-ref $ProjectRef --use-api
  if ($LASTEXITCODE -ne 0) { throw 'Edge Functions deployment failed.' }

  & node scripts/test-edge-functions-cors.mjs --base-url "https://$ProjectRef.supabase.co" --env-file $secretsPath
  if ($LASTEXITCODE -ne 0) { throw 'Live Edge Functions CORS verification failed.' }
} finally {
  if (Test-Path -LiteralPath $runtimeSecretsPath) { Remove-Item -LiteralPath $runtimeSecretsPath -Force }
  Pop-Location
}

Write-Host 'Backend schema, secrets and all Edge Functions completed successfully.'
