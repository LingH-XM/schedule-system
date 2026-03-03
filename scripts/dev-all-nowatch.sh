#!/usr/bin/env bash
set -euo pipefail

BACKEND_MODE=nowatch bash "$(cd "$(dirname "$0")" && pwd)/dev-all.sh"
