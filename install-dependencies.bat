@echo off
setlocal

REM Install project dependencies for ProcureLink v2
REM Runs frontend npm install and backend pip install from requirements.txt

echo.
echo ====================================
echo Installing ProcureLink v2 Dependencies
echo ====================================
echo.

set "ROOT_DIR=%~dp0"
set "FRONTEND_DIR=%ROOT_DIR%frontend"
set "BACKEND_DIR=%ROOT_DIR%backend"

where npm >nul 2>&1
if errorlevel 1 (
    echo Error: npm is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
    echo Error: Python is not installed or not in PATH.
    echo Please install Python from https://www.python.org/
    pause
    exit /b 1
)

echo [1/2] Installing frontend dependencies...
if exist "%FRONTEND_DIR%\package.json" (
    pushd "%FRONTEND_DIR%"
    npm install
    if errorlevel 1 (
        echo Error: frontend dependency install failed.
        popd
        pause
        exit /b 1
    )
    popd
) else (
    echo Warning: frontend\package.json not found. Skipping frontend install.
)

echo.
echo [2/2] Installing backend dependencies...
if exist "%BACKEND_DIR%\requirements.txt" (
    pushd "%BACKEND_DIR%"
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo Error: backend dependency install failed.
        popd
        pause
        exit /b 1
    )
    popd
) else (
    echo Warning: backend\requirements.txt not found. Skipping backend install.
)

echo.
echo ====================================
echo Dependencies installed successfully!
echo ====================================
echo.
echo Next steps:
echo - Run frontend: cd frontend ^&^& npm run dev
echo - Run backend:  cd backend ^&^& python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
echo.
pause
