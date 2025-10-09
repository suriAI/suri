#!/bin/bash
# Build script for Suri Backend on Unix systems (macOS/Linux)
# This script builds the Python backend into a standalone executable

set -e  # Exit on any error

echo "========================================"
echo "Suri Backend Build Script - Unix"
echo "========================================"

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is not installed or not in PATH"
    echo "Please install Python 3.8+ and try again"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "main.py" ]; then
    echo "ERROR: main.py not found"
    echo "Please run this script from the backend directory"
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install/upgrade PyInstaller
echo "Installing/upgrading PyInstaller..."
pip install --upgrade pyinstaller

# Install required dependencies
echo "Installing required dependencies..."
pip install -r requirements.txt

# Run the build script
echo "Starting build process..."
python build_backend.py --test

echo ""
echo "========================================"
echo "Build completed successfully!"
echo "========================================"
echo ""
echo "The executable is located in: dist/suri-backend"
echo "You can now integrate it with your Electron app."
echo ""

# Deactivate virtual environment
deactivate