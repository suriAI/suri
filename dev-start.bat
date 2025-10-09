@echo off
setlocal enabledelayedexpansion

echo ========================================
echo    Suri - Development Mode
echo ========================================
echo.

:: Check if we're in the correct directory
if not exist "server" (
    echo Error: server directory not found. Please run this script from the project root.
    pause
    exit /b 1
)

if not exist "desktop" (
    echo Error: desktop directory not found. Please run this script from the project root.
    pause
    exit /b 1
)

echo Starting development servers...
echo.

:: Start server in a new window
echo Starting Python server...
start "Suri Server" cmd /k "cd server && python run.py"

:: Wait a moment for server to start
timeout /t 3 /nobreak > nul

:: Start frontend
echo Starting Electron frontend...
cd desktop
call pnpm dev

echo.
echo Development servers stopped.
pause