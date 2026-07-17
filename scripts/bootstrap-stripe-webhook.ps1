[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9]{20}$')]
  [string]$ProjectRef,

  [string]$SecretsFile = '.env.edge.local'
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$candidatePath = if ([IO.Path]::IsPathRooted($SecretsFile)) {
  $SecretsFile
} else {
  Join-Path $workspace $SecretsFile
}
$secretsPath = (Resolve-Path -LiteralPath $candidatePath).Path
$workspacePrefix = $workspace.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

if (-not $secretsPath.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'SecretsFile must be inside this repository.'
}

$nodeOutput = (& node (Join-Path $PSScriptRoot 'bootstrap-stripe-webhook.mjs') `
  --env-file $secretsPath `
  --project-ref $ProjectRef `
  --emit-signing-secret) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'Stripe webhook provisioning failed.' }

try {
  $result = $nodeOutput | ConvertFrom-Json
} catch {
  throw 'Stripe webhook provisioning returned invalid JSON.'
}

$expectedUrl = "https://$ProjectRef.supabase.co/functions/v1/stripe-webhook"
if ($result.url -ne $expectedUrl -or [string]$result.endpointId -notmatch '^we_[A-Za-z0-9]{8,128}$') {
  throw 'Stripe webhook provisioning returned an unexpected endpoint.'
}

if ($result.created) {
  $signingSecret = [string]$result.signingSecret
  if ($signingSecret -notmatch '^whsec_[A-Za-z0-9]{16,128}$') {
    throw 'Stripe webhook provisioning returned an invalid signing secret.'
  }

  $source = [IO.File]::ReadAllText($secretsPath)
  $secretLine = "STRIPE_WEBHOOK_SECRET=$signingSecret"
  $updated = if ($source -match '(?m)^STRIPE_WEBHOOK_SECRET=.*$') {
    [regex]::Replace($source, '(?m)^STRIPE_WEBHOOK_SECRET=.*$', $secretLine)
  } else {
    "$($source.TrimEnd())`r`n$secretLine`r`n"
  }
  $endpointLine = "STRIPE_WEBHOOK_ENDPOINT_ID=$($result.endpointId)"
  $updated = if ($updated -match '(?m)^STRIPE_WEBHOOK_ENDPOINT_ID=.*$') {
    [regex]::Replace($updated, '(?m)^STRIPE_WEBHOOK_ENDPOINT_ID=.*$', $endpointLine)
  } else {
    "$($updated.TrimEnd())`r`n$endpointLine`r`n"
  }
  [IO.File]::WriteAllText($secretsPath, $updated, (New-Object Text.UTF8Encoding($false)))
}

# Deliberately omit the signing secret from terminal output.
[pscustomobject]@{
  created = [bool]$result.created
  endpointId = [string]$result.endpointId
  url = [string]$result.url
} | ConvertTo-Json -Compress
