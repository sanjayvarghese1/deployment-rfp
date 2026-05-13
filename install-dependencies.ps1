Write-Host ""
Write-Host "===================================="
Write-Host "Installing ProcureLink v2 Dependencies"
Write-Host "===================================="
Write-Host ""

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Join-Path $RootDir "frontend"
$BackendDir = Join-Path $RootDir "backend"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "Error: npm is not installed or not in PATH."
    Write-Host "Please install Node.js from https://nodejs.org/"
    exit 1
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Python is not installed or not in PATH."
    Write-Host "Please install Python from https://www.python.org/"
    exit 1
}

Write-Host "[1/2] Installing frontend dependencies..."
if (Test-Path (Join-Path $FrontendDir "package.json")) {
    Push-Location $FrontendDir
    try {
        npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Error: frontend dependency install failed."
            exit $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "Warning: frontend/package.json not found. Skipping frontend install."
}

Write-Host ""
Write-Host "[2/2] Installing backend dependencies..."
if (Test-Path (Join-Path $BackendDir "requirements.txt")) {
    Push-Location $BackendDir
    try {
        python -m pip install -r requirements.txt
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Error: backend dependency install failed."
            exit $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "Warning: backend/requirements.txt not found. Skipping backend install."
}

Write-Host ""
Write-Host "===================================="
Write-Host "Dependencies installed successfully!"
Write-Host "===================================="
Write-Host ""
Write-Host "Next steps:"
Write-Host "- Run frontend: cd frontend && npm run dev"
Write-Host "- Run backend:  cd backend && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
