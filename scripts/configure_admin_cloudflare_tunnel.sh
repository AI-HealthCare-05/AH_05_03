#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker/docker-compose.dev-mac.yml"
PROJECT_NAME="ieobom-dev"
ENV_FILE="${IEOBOM_ENV_FILE:-${HOME}/.config/ieobom/dev.env}"
HTTP_PORT="${IEOBOM_HTTP_PORT:-8080}"
STATE_DIR="${HOME}/.local/state/ieobom-cloudflare"
LOG_FILE="${STATE_DIR}/quick-tunnel.log"
TUNNEL_CONTAINER="ieobom-cloudflared"

mkdir -p "${STATE_DIR}"

refresh_tunnel_log() {
  docker logs "${TUNNEL_CONTAINER}" > "${LOG_FILE}" 2>&1 || true
}

existing_url=""
if docker inspect "${TUNNEL_CONTAINER}" >/dev/null 2>&1; then
  refresh_tunnel_log
  existing_url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "${LOG_FILE}" | tail -1 || true)"
fi

if [[ -z "${existing_url}" ]] || ! curl --fail --silent --show-error --max-time 10 "${existing_url}/healthz" >/dev/null 2>&1; then
  docker rm --force "${TUNNEL_CONTAINER}" >/dev/null 2>&1 || true
  : > "${LOG_FILE}"
  docker run --detach \
    --name "${TUNNEL_CONTAINER}" \
    --restart unless-stopped \
    cloudflare/cloudflared:latest \
    tunnel --no-autoupdate --url "http://host.docker.internal:${HTTP_PORT}" >/dev/null
fi

tunnel_url=""
for attempt in $(seq 1 30); do
  refresh_tunnel_log
  tunnel_url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "${LOG_FILE}" | tail -1 || true)"
  if [[ -n "${tunnel_url}" ]] && curl --fail --silent --show-error --max-time 10 "${tunnel_url}/healthz" >/dev/null 2>&1; then
    break
  fi
  echo "Cloudflare tunnel health check ${attempt}/30 is not ready yet."
  sleep 2
done

if [[ -z "${tunnel_url}" ]] || ! curl --fail --silent --show-error --max-time 10 "${tunnel_url}/healthz" >/dev/null; then
  echo "Cloudflare quick tunnel did not become healthy." >&2
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
export CORS_ALLOW_ORIGINS="$(grep '^CORS_ALLOW_ORIGINS=' "${ENV_FILE}" | tail -1 | cut -d= -f2-)"
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
