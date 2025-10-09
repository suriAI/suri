#!/bin/bash

echo "========================================"
echo "    Suri - Development Mode"
echo "========================================"
echo

# Check if we're in the correct directory
if [ ! -d "server" ]; then
    echo "Error: server directory not found. Please run this script from the project root."
    exit 1
fi

if [ ! -d "desktop" ]; then
    echo "Error: desktop directory not found. Please run this script from the project root."
    exit 1
fi

echo "Starting development servers..."
echo

# Function to cleanup background processes
cleanup() {
    echo
    echo "Stopping development servers..."
    if [ ! -z "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null
    fi
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Start server in background
echo "Starting Python server..."
cd server
python run.py &
SERVER_PID=$!
cd ..

# Wait a moment for server to start
sleep 3

# Start frontend (this will block)
echo "Starting Electron frontend..."
cd desktop
pnpm dev

# If we get here, frontend was stopped
cleanup