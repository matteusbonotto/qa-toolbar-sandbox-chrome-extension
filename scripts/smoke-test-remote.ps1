$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Read-EnvFile([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      $values[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
    }
  }
  return $values
}

function Invoke-JsonCurl([string]$Method, [string]$Url, [string[]]$Headers, $Body = $null) {
  $outputPath = [System.IO.Path]::GetTempFileName()
  $inputPath = $null
  try {
    $arguments = @("-sS", "-o", $outputPath, "-w", "%{http_code}", "-X", $Method, $Url, "-H", "User-Agent: qts-server-smoke-test/1.0")
    foreach ($header in $Headers) { $arguments += @("-H", $header) }
    if ($null -ne $Body) {
      $inputPath = [System.IO.Path]::GetTempFileName()
      [System.IO.File]::WriteAllText($inputPath, ($Body | ConvertTo-Json -Compress -Depth 8), [System.Text.UTF8Encoding]::new($false))
      $arguments += @("-H", "Content-Type: application/json", "--data-binary", "@$inputPath")
    }
    $status = [int](& curl.exe @arguments)
    $content = Get-Content -Raw -LiteralPath $outputPath
    if ($status -lt 200 -or $status -ge 300) { throw "$Method $Url returned HTTP $status`: $content" }
    if ([string]::IsNullOrWhiteSpace($content)) { return $null }
    return $content | ConvertFrom-Json
  } finally {
    Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue
    if ($inputPath) { Remove-Item -LiteralPath $inputPath -Force -ErrorAction SilentlyContinue }
  }
}

$values = Read-EnvFile (Join-Path $root ".env")
$projectRef = $values["PROJECT_ID"]
$publicKey = $values["SUPABASE_PUBLIC"]
$secretKey = $values["SUPABASE_SECRET"]
$stripeKey = $values["STRIP_SECRET"]
$base = "https://$projectRef.supabase.co"
$publicHeaders = @("apikey: $publicKey")
$adminHeaders = @("apikey: $secretKey", "Authorization: Bearer $secretKey")
$email = "qts.smoke.$([guid]::NewGuid().ToString('N'))@gmail.com"
$password = "Qts!$([guid]::NewGuid().ToString('N'))"
$userId = $null
$customerId = $null

try {
  $user = Invoke-JsonCurl "POST" "$base/auth/v1/admin/users" $adminHeaders @{
    email = $email
    password = $password
    email_confirm = $true
    user_metadata = @{ terms_version = "2026-07-13"; terms_accepted_at = [DateTime]::UtcNow.ToString("o") }
  }
  $userId = $user.id
  $signin = Invoke-JsonCurl "POST" "$base/functions/v1/auth-sign-in" $publicHeaders @{ email = $email; password = $password }
  $token = $signin.accessToken

  $authHeaders = @("apikey: $publicKey", "Authorization: Bearer $token")
  $installationId = [guid]::NewGuid().ToString()
  Invoke-JsonCurl "POST" "$base/functions/v1/register-installation" $authHeaders @{
    installationId = $installationId; label = "Automated remote smoke test"
  } | Out-Null
  $billing = Invoke-JsonCurl "POST" "$base/functions/v1/billing-status" $authHeaders @{ installationId = $installationId }
  if ($billing.plan.key -ne "scale" -or -not $billing.trial.active) { throw "The 30-day Scale trial was not activated." }

  $checkout = Invoke-JsonCurl "POST" "$base/functions/v1/create-checkout" $authHeaders @{
    priceKey = "pro_monthly"; requestId = [guid]::NewGuid().ToString()
  }
  if (([uri]$checkout.checkoutUrl).Host -ne "checkout.stripe.com") { throw "Stripe Checkout returned an unexpected URL." }

  $customers = Invoke-JsonCurl "GET" "$base/rest/v1/payment_customers?user_id=eq.$userId&select=provider_customer_id" $adminHeaders
  if (@($customers).Count -gt 0) { $customerId = @($customers)[0].provider_customer_id }
  [pscustomobject]@{
    SignIn = "PASS"
    TrialPlan = $billing.plan.key
    TrialActive = $billing.trial.active
    TrialDays = $billing.trial.daysRemaining
    CheckoutHost = ([uri]$checkout.checkoutUrl).Host
    Checkout = "PASS"
  }
} finally {
  if ($customerId) {
    try { Invoke-JsonCurl "DELETE" "https://api.stripe.com/v1/customers/$customerId" @("Authorization: Bearer $stripeKey") | Out-Null } catch { Write-Warning "Could not remove the disposable Stripe customer." }
  }
  if ($userId) {
    try { Invoke-JsonCurl "DELETE" "$base/auth/v1/admin/users/$userId" $adminHeaders | Out-Null } catch { Write-Warning "Could not remove the disposable Supabase user." }
  }
}
