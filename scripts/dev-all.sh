#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

FRONTEND_CMD=(npm run dev)
BACKEND_CMD=(npm --prefix backend run dev)
BACKEND_NOWATCH_CMD=(/bin/zsh -lc "npm --prefix backend run build && node backend/dist/main.js")
SOLVER_CMD=(uvicorn solver_api:app --host 127.0.0.1 --port 8790)
BACKEND_MODE="${BACKEND_MODE:-watch}"

PIDS=()

cleanup() {
  echo ""
  echo "[dev:all] stopping services..."
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  wait || true
  echo "[dev:all] all stopped"
}

trap cleanup INT TERM EXIT

cd "$ROOT_DIR"

if [ -d "backend/solver/.venv" ]; then
  echo "[dev:all] starting OR-Tools solver on :8790"
  (
    cd backend/solver
    # shellcheck disable=SC1091
    source .venv/bin/activate
    exec "${SOLVER_CMD[@]}"
  ) &
  PIDS+=("$!")
  export SCHEDULER_ENGINE="ortools-cpsat"
  export ORTOOLS_SOLVER_URL="http://127.0.0.1:8790/solve-cpsat"
  export SCHEDULER_STRICT_ORTOOLS="false"
else
  echo "[dev:all] backend/solver/.venv not found, fallback to greedy-v1"
  export SCHEDULER_ENGINE="greedy-v1"
fi

echo "[dev:all] starting Nest backend on :8787 (mode=${BACKEND_MODE})"
if [ "${BACKEND_MODE}" = "nowatch" ]; then
  ("${BACKEND_NOWATCH_CMD[@]}") &
else
  ("${BACKEND_CMD[@]}") &
fi
PIDS+=("$!")

echo "[dev:all] starting Vite frontend on :5173"
("${FRONTEND_CMD[@]}") &
PIDS+=("$!")

echo "[dev:all] started. press Ctrl+C to stop all"
wait
