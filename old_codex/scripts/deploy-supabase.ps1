param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef
)

$ErrorActionPreference = 'Stop'

function Read-EnvironmentFile([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      $values[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
    }
  }
  return $values
}

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_ACCESS_TOKEN)) {
  throw 'SUPABASE_ACCESS_TOKEN with project deployment privileges is required.'
}

$privateValues = Read-EnvironmentFile (Join-Path $PSScriptRoot '..\.env')
$billingValues = Read-EnvironmentFile (Join-Path $PSScriptRoot '..\.env.billing')
$requiredRuntimeSecrets = @('STRIPE_WEBHOOK_SECRET', 'KEEP_ALIVE_SECRET', 'FOUNDER_BOOTSTRAP_SECRET')
foreach ($name in $requiredRuntimeSecrets) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "$name must be set in the process environment before deployment."
  }
}

$baseUrl = "https://$ProjectRef.supabase.co/functions/v1"
$chromeStoreUrl = if ($env:CHROME_WEB_STORE_URL) { $env:CHROME_WEB_STORE_URL } else { 'https://chromewebstore.google.com/detail/qa-toolbar-sandbox/ddaapjklnfjhjigeglgmjmadjnmdodfe?authuser=0&hl=pt-BR' }
npx supabase link --project-ref $ProjectRef
npx supabase db push --include-seed
npx supabase secrets set --project-ref $ProjectRef `
  "STRIPE_SECRET_KEY=$($privateValues['STRIP_SECRET'])" `
  "STRIPE_PUBLISHABLE_KEY=$($privateValues['STRIP_PUBLIC'])" `
  "STRIPE_WEBHOOK_SECRET=$env:STRIPE_WEBHOOK_SECRET" `
  "STRIPE_PRO_MONTHLY_PRICE_ID=$($billingValues['STRIPE_PRO_MONTHLY_PRICE_ID'])" `
  "STRIPE_PRO_YEARLY_PRICE_ID=$($billingValues['STRIPE_PRO_YEARLY_PRICE_ID'])" `
  "STRIPE_SCALE_MONTHLY_PRICE_ID=$($billingValues['STRIPE_SCALE_MONTHLY_PRICE_ID'])" `
  "STRIPE_SCALE_YEARLY_PRICE_ID=$($billingValues['STRIPE_SCALE_YEARLY_PRICE_ID'])" `
  "STRIPE_REFERRAL_PROMOTION_CODE_ID=$($billingValues['STRIPE_REFERRAL_PROMOTION_CODE_ID'])" `
  "STRIPE_30OFF_PROMOTION_CODE_ID=$($billingValues['STRIPE_30OFF_PROMOTION_CODE_ID'])" `
  "APP_SUPABASE_PUBLIC_KEY=$($privateValues['SUPABASE_PUBLIC'])" `
  "APP_SUPABASE_SECRET_KEY=$($privateValues['SUPABASE_SECRET'])" `
  "CHECKOUT_SUCCESS_URL=$baseUrl/checkout-success" `
  "CHECKOUT_CANCEL_URL=$baseUrl/checkout-cancel" `
  "CHROME_WEB_STORE_URL=$chromeStoreUrl" `
  "KEEP_ALIVE_SECRET=$env:KEEP_ALIVE_SECRET" `
  "FOUNDER_BOOTSTRAP_SECRET=$env:FOUNDER_BOOTSTRAP_SECRET" `
  "ALLOWED_ORIGINS=$env:ALLOWED_ORIGINS" `
  "ALLOWED_EXTENSION_IDS=$env:ALLOWED_EXTENSION_IDS"
npx supabase functions deploy --project-ref $ProjectRef

Write-Output 'Supabase migrations, secrets and Edge Functions deployed.'
