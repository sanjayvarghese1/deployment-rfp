#!/bin/bash
# Setup script for installing project dependencies (Unix/Linux/macOS)
# This script automatically installs all npm dependencies

echo ""
echo "===================================="
echo "Installing Project Dependencies"
echo "===================================="
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed or not in PATH"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

echo "Detected npm version:"
npm --version
echo ""

# Install dependencies
echo "Installing npm packages..."
npm install

if [ $? -ne 0 ]; then
    echo "Error: npm install failed"
    exit 1
fi

echo ""
echo "===================================="
echo "Dependencies installed successfully!"
echo "===================================="
echo ""
echo "Next steps:"
echo "- Run 'npm run dev' to start the development server"
echo "- Run 'npm run build' to build for production"
echo ""
