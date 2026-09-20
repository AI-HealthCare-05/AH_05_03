#!/usr/bin/env bash
# 865b299(또는 현재 feat/206-tool-policy) 미리보기. 기존 5173/8000 스택은 건드리지 않는다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${IEOBOM_PR218_API_PORT:-8018}"
WEB_PORT="${IEOBOM_PR218_WEB_PORT:-5180}"
ENV_FILE="${IEOBOM_ENV_FILE:-$ROOT/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "env file missing: $ENV_FILE" >&2
  echo "Set IEOBOM_ENV_FILE to a dotenv that this worktree can use. Do not point the preview at 5173/8000." >&2
  exit 1
fi

if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $API_PORT already in use" >&2
  exit 1
fi
if lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $WEB_PORT already in use" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

cd "$ROOT"
uv run uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" &
API_PID=$!
cleanup() {
  kill "$API_PID" "$WEB_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

until curl -sf "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1; do
  sleep 0.4
done

cd "$ROOT/frontend"
IEOBOM_API_PROXY="http://127.0.0.1:${API_PORT}" npx vite --host 127.0.0.1 --port "$WEB_PORT" --strictPort &
WEB_PID=$!

echo "PR218 preview web=http://127.0.0.1:${WEB_PORT} api=http://127.0.0.1:${API_PORT}"
echo "Not bound to 5173 or 8000. Browser gate still needs a PIN member on this API."
wait
