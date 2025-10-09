@echo off
REM Build script for Suri Backend on Windows
REM This script builds the Python backend into a standalone executable

echo ========================================
echo Suri Backend Build Script - Windows
echo ========================================

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.8+ and try again
    pause
    exit /b 1
)

REM Check if we're in the right directory
if not exist "main.py" (
    echo ERROR: main.py not found
    echo Please run this script from the backend directory
    pause
    exit /b 1
)

REM Install/upgrade PyInstaller
echo Installing/upgrading PyInstaller...
python -m pip install --upgrade pyinstaller

REM Install required dependencies
echo Installing required dependencies...
python -m pip install -r requirements.txt

REM Run the build script
echo Starting build process...
python build_backend.py --test

if errorlevel 1 (
    echo BUILD FAILED!
    pause
    exit /b 1
)

echo.
echo ========================================
echo Build completed successfully!
echo ========================================
echo.
echo The executable is located in: dist\suri-backend.exe
echo You can now integrate it with your Electron app.
echo.

pause