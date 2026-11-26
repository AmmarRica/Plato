# Plato the Foodie Philosopher: create the virtual environment and start the server.
# Usage:  ./start.ps1          (needs only Python 3 installed)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$python = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }
if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment (.venv)..."
    & $python -m venv .venv
}
$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

# Packages: tzdata (time zones on Windows) and anthropic (optional Ask Plato).
# The app still starts if this fails, e.g. when offline.
$stamp = ".venv\.requirements-installed"
if (-not (Test-Path $stamp) -or ((Get-Item requirements.txt).LastWriteTime -gt (Get-Item $stamp).LastWriteTime)) {
    Write-Host "Installing packages..."
    $ErrorActionPreference = "Continue"
    & $venvPython -m pip install --quiet --disable-pip-version-check -r requirements.txt
    if ($LASTEXITCODE -eq 0) { Set-Content $stamp (Get-Date) } else { Write-Warning "pip install failed; continuing without optional packages." }
    $ErrorActionPreference = "Stop"
}

New-Item -ItemType Directory -Force -Path data, exports | Out-Null
& $venvPython server.py
