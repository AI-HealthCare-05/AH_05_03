#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker/docker-compose.dev-mac.yml"
PROJECT_NAME="ieobom-dev"
ENV_FILE="${IEOBOM_ENV_FILE:-${HOME}/.config/ieobom/dev.env}"
HTTP_PORT="${IEOBOM_HTTP_PORT:-8080}"
STATE_DIR="${HOME}/.local/state/ieobom-cloudflare"
LOG_FILE="${STATE_DIR}/quick-tunnel.log"
BIN_DIR="${STATE_DIR}/bin"
CLOUDFLARED_BIN="${BIN_DIR}/cloudflared"
PLIST_FILE="${HOME}/Library/LaunchAgents/com.ieobom.cloudflare-dev.plist"
LABEL="com.ieobom.cloudflare-dev"
NAMED_CONFIG="${IEOBOM_CLOUDFLARED_CONFIG:-${HOME}/.cloudflared/config.yml}"
NAMED_ORIGIN="${IEOBOM_CLOUDFLARE_ORIGIN:-https://ieobom.cromtind.uk}"

# Named Tunnel은 LaunchAgent가 상시 관리한다. 정상인 배포마다 plist를 다시 쓰고
# FastAPI/nginx를 재생성하던 작업을 건너뛰며, 공개 주소와 CORS만 확인한다.
if [[ -f "${NAMED_CONFIG}" ]]; then
  healthy_origin="${NAMED_ORIGIN%/}"
  if curl --fail --silent --show-error --max-time 5 "${healthy_origin}/healthz" >/dev/null 2>&1; then
    origin_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 \
      --header "Origin: ${healthy_origin}" "${healthy_origin}/api/openapi.json")"
    if [[ "${origin_status}" != "403" ]] && [[ "${origin_status}" != "000" ]]; then
      echo "Cloudflare named tunnel is already healthy: ${healthy_origin}"
      if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
        printf '### Admin Mac Cloudflare tunnel\n\n%s\n' "${healthy_origin}" >> "${GITHUB_STEP_SUMMARY}"
      fi
      exit 0
    fi
  fi
fi

mkdir -p "${STATE_DIR}" "${BIN_DIR}" "$(dirname "${PLIST_FILE}")"

if [[ ! -x "${CLOUDFLARED_BIN}" ]]; then
  case "$(uname -m)" in
    arm64) cloudflared_arch="arm64" ;;
    x86_64) cloudflared_arch="amd64" ;;
    *) echo "Unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
  esac
  archive="$(mktemp "${STATE_DIR}/cloudflared.XXXXXX.tgz")"
  curl --fail --location --silent --show-error \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${cloudflared_arch}.tgz" \
    --output "${archive}"
  tar -xzf "${archive}" -C "${BIN_DIR}" cloudflared
  rm -f "${archive}"
  chmod 755 "${CLOUDFLARED_BIN}"
fi

write_launch_agent() {
  local mode="$1"
  local target="$2"
  local log_file="$3"

  launchctl bootout "gui/$(id -u)" "${PLIST_FILE}" >/dev/null 2>&1 || true
  : > "${log_file}"
  if [[ "${mode}" == "named" ]]; then
    program_arguments="
    <string>tunnel</string>
    <string>--no-autoupdate</string>
    <string>--config</string>
    <string>${target}</string>
    <string>run</string>"
  else
    program_arguments="
    <string>tunnel</string>
    <string>--no-autoupdate</string>
    <string>--url</string>
    <string>${target}</string>"
  fi
  cat > "${PLIST_FILE}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${CLOUDFLARED_BIN}</string>
    ${program_arguments}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log_file}</string>
  <key>StandardErrorPath</key><string>${log_file}</string>
</dict>
</plist>
EOF
  plutil -lint "${PLIST_FILE}"
  launchctl bootstrap "gui/$(id -u)" "${PLIST_FILE}"
}

tunnel_url=""
if [[ -f "${NAMED_CONFIG}" ]]; then
  LOG_FILE="${STATE_DIR}/named-tunnel.log"
  tunnel_url="${NAMED_ORIGIN%/}"
  if ! curl --fail --silent --show-error --max-time 10 "${tunnel_url}/healthz" >/dev/null 2>&1; then
    write_launch_agent named "${NAMED_CONFIG}" "${LOG_FILE}"
    for attempt in $(seq 1 30); do
      if curl --fail --silent --show-error --max-time 10 "${tunnel_url}/healthz" >/dev/null 2>&1; then
        break
      fi
      echo "Cloudflare named tunnel health check ${attempt}/30 is not ready yet."
      sleep 2
    done
  fi
else
  existing_url=""
  if [[ -f "${LOG_FILE}" ]]; then
    existing_url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "${LOG_FILE}" | tail -1 || true)"
  fi
  if [[ -z "${existing_url}" ]] || ! curl --fail --silent --show-error --max-time 10 "${existing_url}/healthz" >/dev/null 2>&1; then
    write_launch_agent quick "http://127.0.0.1:${HTTP_PORT}" "${LOG_FILE}"
  fi
  for attempt in $(seq 1 30); do
    tunnel_url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "${LOG_FILE}" | tail -1 || true)"
    if [[ -n "${tunnel_url}" ]] && curl --fail --silent --show-error --max-time 10 "${tunnel_url}/healthz" >/dev/null 2>&1; then
      break
    fi
    echo "Cloudflare tunnel health check ${attempt}/30 is not ready yet."
    sleep 2
  done
fi

if [[ -z "${tunnel_url}" ]] || ! curl --fail --silent --show-error --max-time 10 "${tunnel_url}/healthz" >/dev/null; then
  echo "Cloudflare tunnel did not become healthy." >&2
  tail -100 "${LOG_FILE}" >&2
  exit 1
fi

python3 - "${ENV_FILE}" "${tunnel_url}" <<'PY'
import json
import os
import sys
import tempfile

env_path, tunnel_url = sys.argv[1:]
lines = []
if os.path.exists(env_path):
    with open(env_path, encoding="utf-8") as source:
        lines = source.read().splitlines()

values = {}
order = []
for line in lines:
    if not line or line.lstrip().startswith("#") or "=" not in line:
        order.append((None, line))
        continue
    key, value = line.split("=", 1)
    values[key] = value
    order.append((key, None))

origins = []
for encoded in (
    values.get("CORS_ALLOW_ORIGINS", "[]"),
    os.environ.get("IEOBOM_DEV_CORS_ALLOW_ORIGINS", "[]"),
):
    try:
        for origin in json.loads(encoded):
            if origin not in origins:
                origins.append(origin)
    except (json.JSONDecodeError, TypeError):
        pass
if tunnel_url not in origins:
    origins.append(tunnel_url)
values["CORS_ALLOW_ORIGINS"] = json.dumps(origins, ensure_ascii=False, separators=(",", ":"))
values["INVITATION_WEB_ORIGIN"] = tunnel_url

seen = set()
output = []
for key, literal in order:
    if key is None:
        output.append(literal)
    elif key not in seen:
        output.append(f"{key}={values[key]}")
        seen.add(key)
for key in ("CORS_ALLOW_ORIGINS", "INVITATION_WEB_ORIGIN"):
    if key not in seen:
        output.append(f"{key}={values[key]}")

directory = os.path.dirname(env_path)
os.makedirs(directory, exist_ok=True)
fd, temp_path = tempfile.mkstemp(prefix="dev.env.", dir=directory, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as target:
        target.write("\n".join(output) + "\n")
    os.chmod(temp_path, 0o600)
    os.replace(temp_path, env_path)
finally:
    if os.path.exists(temp_path):
        os.unlink(temp_path)
PY

export DEV_HTTP_PORT="${HTTP_PORT}"
export DEPLOY_VERSION="${DEPLOY_SHA:-local}"
export INVITATION_WEB_ORIGIN="${tunnel_url}"
CORS_ALLOW_ORIGINS="$(grep '^CORS_ALLOW_ORIGINS=' "${ENV_FILE}" | tail -1 | cut -d= -f2-)"
export CORS_ALLOW_ORIGINS
if [[ -n "${IEOBOM_DEV_REFRESH_COOKIE_SECURE:-}" ]]; then
  export REFRESH_COOKIE_SECURE="${IEOBOM_DEV_REFRESH_COOKIE_SECURE}"
fi

compose() {
  docker compose \
    --project-name "${PROJECT_NAME}" \
    --env-file "${ENV_FILE}" \
    --file "${COMPOSE_FILE}" \
    "$@"
}

# FastAPI must reload the exact newly generated origin. nginx is recreated
# because it resolves the FastAPI container address at startup.
compose up -d --no-deps --force-recreate fastapi email-worker
compose up -d --no-deps --force-recreate nginx

for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 10 "${tunnel_url}/healthz" >/dev/null; then
    break
  fi
  echo "Post-restart tunnel health check ${attempt}/30 is not ready yet."
  sleep 2
done

curl --fail --silent --show-error --max-time 10 "${tunnel_url}/healthz" >/dev/null
origin_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --header "Origin: ${tunnel_url}" "${tunnel_url}/api/openapi.json")"
if [[ "${origin_status}" == "403" ]]; then
  echo "Cloudflare origin is still rejected by the API." >&2
  exit 1
fi

echo "Cloudflare admin tunnel: ${tunnel_url}"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '### Admin Mac Cloudflare tunnel\n\n%s\n' "${tunnel_url}" >> "${GITHUB_STEP_SUMMARY}"
fi
