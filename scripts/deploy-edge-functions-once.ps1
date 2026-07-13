param(
  [string]$ProjectRef,
  [string]$AllowedOrigins = "http://127.0.0.1:4173,http://localhost:4173",
  [string]$AllowedExtensionIds = "jaalcifngdkpenjdolhlkgcaepdpkgoe"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Read-EnvFile([string]$Path) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $values }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      $values[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
    }
  }
  return $values
}

function New-StrongSecret {
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Require-Value([hashtable]$Values, [string]$Name) {
  $value = [string]$Values[$Name]
  if ([string]::IsNullOrWhiteSpace($value)) { throw "Missing $Name in the local configuration." }
  return $value
}

$private = Read-EnvFile (Join-Path $root ".env")
$billing = Read-EnvFile (Join-Path $root ".env.billing")
$runtimePath = Join-Path $root ".env.edge.local"
$runtime = Read-EnvFile $runtimePath

if ([string]::IsNullOrWhiteSpace($ProjectRef)) { $ProjectRef = Require-Value $private "PROJECT_ID" }
$stripeSecret = Require-Value $private "STRIP_SECRET"
$stripePublic = Require-Value $private "STRIP_PUBLIC"
$supabasePublic = Require-Value $private "SUPABASE_PUBLIC"
$supabaseSecret = Require-Value $private "SUPABASE_SECRET"
$webhookUrl = "https://$ProjectRef.supabase.co/functions/v1/stripe-webhook"

$webhookSecret = [string]$runtime["STRIPE_WEBHOOK_SECRET"]
if ([string]::IsNullOrWhiteSpace($webhookSecret)) {
  $headers = @{ Authorization = "Bearer $stripeSecret" }
  $existing = Invoke-RestMethod -Method Get -Uri "https://api.stripe.com/v1/webhook_endpoints?limit=100" -Headers $headers
  $matching = @($existing.data | Where-Object { $_.url -eq $webhookUrl -and $_.status -eq "enabled" })
  if ($matching.Count -gt 0) {
    throw "A Stripe webhook already exists for this URL, but its signing secret is not in .env.edge.local. Roll its secret in Stripe and save STRIPE_WEBHOOK_SECRET locally before rerunning."
  }
  $stripeArguments = @(
    "-sS", "-X", "POST", "https://api.stripe.com/v1/webhook_endpoints",
    "-H", "Authorization: Bearer $stripeSecret",
    "--data-urlencode", "url=$webhookUrl",
    "--data-urlencode", "description=QA Toolbar Sandbox Supabase webhook",
    "--data", "enabled_events[]=checkout.session.completed",
    "--data", "enabled_events[]=customer.subscription.created",
    "--data", "enabled_events[]=customer.subscription.updated",
    "--data", "enabled_events[]=customer.subscription.deleted",
    "--data", "enabled_events[]=invoice.paid",
    "--data", "enabled_events[]=invoice.payment_failed"
  )
  $created = (& curl.exe @stripeArguments | ConvertFrom-Json)
  if ($created.error) { throw "Stripe webhook creation failed: $($created.error.message)" }
  $webhookSecret = [string]$created.secret
  if ([string]::IsNullOrWhiteSpace($webhookSecret)) { throw "Stripe did not return the webhook signing secret." }
}

$keepAliveSecret = if ($runtime["KEEP_ALIVE_SECRET"]) { [string]$runtime["KEEP_ALIVE_SECRET"] } else { New-StrongSecret }
$founderSecret = if ($runtime["FOUNDER_BOOTSTRAP_SECRET"]) { [string]$runtime["FOUNDER_BOOTSTRAP_SECRET"] } else { New-StrongSecret }
$successUrl = "https://$ProjectRef.supabase.co/functions/v1/checkout-success"
$cancelUrl = "https://$ProjectRef.supabase.co/functions/v1/checkout-cancel"

$secretLines = @(
  "STRIPE_SECRET_KEY=$stripeSecret",
  "STRIPE_PUBLISHABLE_KEY=$stripePublic",
  "STRIPE_WEBHOOK_SECRET=$webhookSecret",
  "STRIPE_PRO_MONTHLY_PRICE_ID=$(Require-Value $billing 'STRIPE_PRO_MONTHLY_PRICE_ID')",
  "STRIPE_PRO_YEARLY_PRICE_ID=$(Require-Value $billing 'STRIPE_PRO_YEARLY_PRICE_ID')",
  "STRIPE_SCALE_MONTHLY_PRICE_ID=$(Require-Value $billing 'STRIPE_SCALE_MONTHLY_PRICE_ID')",
  "STRIPE_SCALE_YEARLY_PRICE_ID=$(Require-Value $billing 'STRIPE_SCALE_YEARLY_PRICE_ID')",
  "STRIPE_REFERRAL_PROMOTION_CODE_ID=$(Require-Value $billing 'STRIPE_REFERRAL_PROMOTION_CODE_ID')",
  "APP_SUPABASE_PUBLIC_KEY=$supabasePublic",
  "APP_SUPABASE_SECRET_KEY=$supabaseSecret",
  "CHECKOUT_SUCCESS_URL=$successUrl",
  "CHECKOUT_CANCEL_URL=$cancelUrl",
  "KEEP_ALIVE_SECRET=$keepAliveSecret",
  "FOUNDER_BOOTSTRAP_SECRET=$founderSecret",
  "ALLOWED_ORIGINS=$AllowedOrigins",
  "ALLOWED_EXTENSION_IDS=$AllowedExtensionIds"
)
[System.IO.File]::WriteAllLines($runtimePath, $secretLines, [System.Text.UTF8Encoding]::new($false))

Push-Location $root
try {
  npx -y supabase@latest secrets set --project-ref $ProjectRef --env-file $runtimePath
  if ($LASTEXITCODE -ne 0) { throw "Supabase refused to save Edge secrets. Confirm that the logged-in account is Project Owner or Administrator." }

  npx -y supabase@latest functions deploy --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { throw "Edge Function deployment failed." }

  $base = "https://$ProjectRef.supabase.co/functions/v1"
  $checks = @(
    @{ Name = "auth-sign-in"; Expected = "400"; Headers = @() },
    @{ Name = "auth-sign-up"; Expected = "400"; Headers = @() },
    @{ Name = "billing-status"; Expected = "401"; Headers = @() },
    @{ Name = "create-checkout"; Expected = "401"; Headers = @() },
    @{ Name = "stripe-webhook"; Expected = "400"; Headers = @() },
    @{ Name = "keep-alive"; Expected = "200"; Headers = @("-H", "x-keep-alive-secret: $keepAliveSecret") }
  )
  foreach ($check in $checks) {
    $arguments = @("-sS", "-o", "NUL", "-w", "%{http_code}", "-X", "POST", "$base/$($check.Name)", "-H", "apikey: $supabasePublic", "-H", "Content-Type: application/json", "--data", "{}") + $check.Headers
    $status = & curl.exe @arguments
    if ($status -ne $check.Expected) { throw "$($check.Name) returned HTTP $status; expected $($check.Expected)." }
    Write-Output "PASS $($check.Name) HTTP $status"
  }
  Write-Output "All Edge Functions were deployed and passed their HTTP smoke tests."
} finally {
  Pop-Location
}
