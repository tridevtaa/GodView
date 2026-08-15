Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendScript = Join-Path $rootDir "backend\start-backend.ps1"
$frontendScript = Join-Path $rootDir "frontend\start-frontend.ps1"

if (-not (Test-Path $backendScript)) {
    throw "Missing backend startup script at '$backendScript'."
}

if (-not (Test-Path $frontendScript)) {
    throw "Missing frontend startup script at '$frontendScript'."
}

$backendDir = Join-Path $rootDir "backend"
$frontendDir = Join-Path $rootDir "frontend"
$venvPython = Join-Path $backendDir "venv\Scripts\python.exe"
$serviceAccountFile = Join-Path $backendDir "serviceAccountKey.json"
$frontendEnvFile = Join-Path $frontendDir ".env"
$frontendNodeModules = Join-Path $frontendDir "node_modules"

if (-not (Test-Path $venvPython)) {
    throw "Backend venv is missing. Create it in '$backendDir' with Python 3.11 or 3.12 and install requirements first."
}

if (-not (Test-Path $serviceAccountFile)) {
    throw "Missing Firebase service account file at '$serviceAccountFile'."
}

if (-not (Test-Path $frontendEnvFile)) {
    throw "Missing frontend env file at '$frontendEnvFile'. Copy frontend/.env.example to frontend/.env and fill it in."
}

if (-not (Test-Path $frontendNodeModules)) {
    throw "Frontend dependencies are missing. Run 'npm install' in '$frontendDir' first."
}

Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-File", $backendScript
)

Start-Sleep -Seconds 2

Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-File", $frontendScript
)

Write-Host "Launched backend and frontend in separate PowerShell windows."
