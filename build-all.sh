#!/bin/bash

set -e  # Exit on any error

echo "========================================"
echo "    Suri - Complete Build Script"
echo "========================================"
echo

# Check if we're in the correct directory
if [ ! -d "backend" ]; then
    echo "Error: backend directory not found. Please run this script from the project root."
    exit 1
fi

if [ ! -d "desktop" ]; then
    echo "Error: desktop directory not found. Please run this script from the project root."
    exit 1
fi

# Detect platform
PLATFORM=$(uname -s)
case $PLATFORM in
    Darwin)
        DIST_COMMAND="dist:mac"
        PLATFORM_NAME="macOS"
        ;;
    Linux)
        DIST_COMMAND="dist:linux"
        PLATFORM_NAME="Linux"
        ;;
    *)
        echo "Error: Unsupported platform: $PLATFORM"
        exit 1
        ;;
esac

echo "Building for platform: $PLATFORM_NAME"
echo

# Build Backend
echo "[1/3] Building Python Backend..."
echo "====================================="
cd backend
chmod +x build_unix.sh
./build_unix.sh
cd ..
echo

# Build Frontend
echo "[2/3] Building Electron Frontend..."
echo "==================================="
cd desktop
echo "Installing dependencies..."
pnpm install

echo "Building frontend..."
pnpm build
cd ..
echo

# Package Application
echo "[3/3] Packaging Application..."
echo "=============================="
cd desktop
pnpm $DIST_COMMAND
cd ..

echo
echo "========================================"
echo "    Build Complete!"
echo "========================================"
echo
echo "The packaged application can be found in:"
echo "  desktop/dist/"
echo
echo "Backend executable location:"
echo "  backend/dist/server"
echo