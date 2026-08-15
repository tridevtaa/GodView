Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $backendDir "venv\Scripts\python.exe"
$serviceAccountFile = Join-Path $backendDir "serviceAccountKey.json"

if (-not (Test-Path $venvPython)) {
    throw "Missing backend venv Python at '$venvPython'. Create it with Python 3.11 or 3.12 and install requirements first."
}

if (-not (Test-Path $serviceAccountFile)) {
    throw "Missing Firebase service account file at '$serviceAccountFile'."
}

$env:GOOGLE_APPLICATION_CREDENTIALS = $serviceAccountFile

Write-Host "Starting backend on http://localhost:5000"
Set-Location $backendDir
& $venvPython app.py
