@echo off
REM Setup script for installing project dependencies (Windows)
REM This script automatically installs all npm dependencies

echo.
echo ====================================
echo Installing Project Dependencies
echo ====================================
echo.

REM Check if npm is installed
npm --version >nul 2>&1
if errorlevel 1 (
    echo Error: npm is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Detected npm version:
npm --version
echo.

REM Install dependencies
echo Installing npm packages...
npm install

if errorlevel 1 (
    echo Error: npm install failed
    pause
    exit /b 1
)

echo.
echo ====================================
echo Dependencies installed successfully!
echo ====================================
echo.
echo Next steps:
echo - Run 'npm run dev' to start the development server
echo - Run 'npm run build' to build for production
echo.
pause
