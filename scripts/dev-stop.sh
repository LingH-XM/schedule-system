#!/usr/bin/env bash
set -euo pipefail

pkill -f "vite --host 127.0.0.1" >/dev/null 2>&1 || true
pkill -f "tsx watch src/main.ts" >/dev/null 2>&1 || true
pkill -f "node backend/dist/main.js" >/dev/null 2>&1 || true
pkill -f "uvicorn solver_api:app" >/dev/null 2>&1 || true

echo "[dev:stop] done"
