#!/usr/bin/env bash
# 전체 검증: 엔진 검사 + (모의 서버를 띄워) 화면 검사.  사용: bash backtest/tests/run_all_20261106.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; PORT="${PORT:-8190}"
node "$HERE/engine_checks_20261106.js" || exit 1
( cd "$HERE/.." && MOCK=1 PORT=$PORT python3 server_20261030.py >/dev/null 2>&1 ) & SP=$!
trap 'kill $SP 2>/dev/null' EXIT
for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 0.5; done
BASE="http://localhost:$PORT" node "$HERE/ui_checks_20261106.js"
