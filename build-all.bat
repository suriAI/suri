@echo off
setlocal enabledelayedexpansion

echo ========================================
echo    Suri - Complete Build Script
echo ========================================
echo.

:: Check if we're in the correct directory
if not exist "backend" (
    echo Error: backend directory not found. Please run this script from the project root.
    pause
    exit /b 1
)

if not exist "desktop" (
    echo Error: desktop directory not found. Please run this script from the project root.
    pause
    exit /b 1
)

:: Build Backend
echo [1/3] Building Python Backend...
echo =====================================
cd backend
call build_windows.bat
if !errorlevel! neq 0 (
    echo Error: Backend build failed!
    cd ..
    pause
    exit /b 1
)
cd ..
echo.

:: Build Frontend
echo [2/3] Building Electron Frontend...
echo ===================================
cd desktop
echo Installing dependencies...
call pnpm install
if !errorlevel! neq 0 (
    echo Error: Failed to install frontend dependencies!
    cd ..
    pause
    exit /b 1
)

echo Building frontend...
call pnpm build
if !errorlevel! neq 0 (
    echo Error: Frontend build failed!
    cd ..
    pause
    exit /b 1
)
cd ..
echo.

:: Package Application
echo [3/3] Packaging Application...
echo ==============================
cd desktop
call pnpm dist:win
if !errorlevel! neq 0 (
    echo Error: Application packaging failed!
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo ========================================
echo    Build Complete!
echo ========================================
echo.
echo The packaged application can be found in:
echo   desktop/dist/
echo.
echo Backend executable location:
echo   backend/dist/server.exe
echo.
pause