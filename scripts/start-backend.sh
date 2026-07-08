#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate yanxi
cd "$ROOT/backend"
exec uvicorn app.main:app --reload --host 127.0.0.1 --port 24000
