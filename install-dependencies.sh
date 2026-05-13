#!/bin/bash
# Install project dependencies for ProcureLink v2
# Runs frontend npm install and backend pip install from requirements.txt

set -e

echo ""
echo "===================================="
echo "Installing ProcureLink v2 Dependencies"
echo "===================================="
echo ""

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed or not in PATH."
  echo "Please install Node.js from https://nodejs.org/"
  exit 1
fi

if ! command -v python >/dev/null 2>&1; then
  echo "Error: Python is not installed or not in PATH."
  echo "Please install Python from https://www.python.org/"
  exit 1
fi

echo "[1/2] Installing frontend dependencies..."
if [ -f "$FRONTEND_DIR/package.json" ]; then
  (cd "$FRONTEND_DIR" && npm install)
else
  echo "Warning: frontend/package.json not found. Skipping frontend install."
fi

echo ""
echo "[2/2] Installing backend dependencies..."
if [ -f "$BACKEND_DIR/requirements.txt" ]; then
  (cd "$BACKEND_DIR" && python -m pip install -r requirements.txt)
else
  echo "Warning: backend/requirements.txt not found. Skipping backend install."
fi

echo ""
echo "===================================="
echo "Dependencies installed successfully!"
echo "===================================="
echo ""
echo "Next steps:"
echo "- Run frontend: cd frontend && npm run dev"
echo "- Run backend:  cd backend && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
