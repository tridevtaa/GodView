Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$frontendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $frontendDir ".env"
$nodeModulesDir = Join-Path $frontendDir "node_modules"

if (-not (Test-Path $envFile)) {
    throw "Missing frontend env file at '$envFile'. Copy .env.example to .env and fill in the Firebase values."
}

if (-not (Test-Path $nodeModulesDir)) {
    throw "Missing frontend dependencies at '$nodeModulesDir'. Run 'npm install' in the frontend folder first."
}

$requiredKeys = @(
    "VITE_BACKEND_URL",
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_MESSAGING_SENDER_ID",
    "VITE_FIREBASE_APP_ID"
)

$envLines = Get-Content $envFile | Where-Object { $_ -and -not $_.TrimStart().StartsWith("#") }
$envMap = @{}
foreach ($line in $envLines) {
    $parts = $line -split "=", 2
    if ($parts.Count -eq 2) {
        $envMap[$parts[0].Trim()] = $parts[1].Trim()
    }
}

$missingKeys = $requiredKeys | Where-Object { -not $envMap.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($envMap[$_]) }
if ($missingKeys.Count -gt 0) {
    throw "Missing required values in frontend/.env: $($missingKeys -join ', ')"
}

Write-Host "Starting frontend on http://localhost:5173"
Set-Location $frontendDir
& npm run dev
