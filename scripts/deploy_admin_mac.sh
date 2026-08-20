#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker/docker-compose.dev-mac.yml"
PROJECT_NAME="ieobom-dev"
ENV_FILE="${IEOBOM_ENV_FILE:-${HOME}/.config/ieobom/dev.env}"
HTTP_PORT="${IEOBOM_HTTP_PORT:-8080}"
if [[ "${DEPLOY_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
  DEPLOY_VERSION="${DEPLOY_SHA}"
else
  DEPLOY_VERSION="$(git -C "${ROOT_DIR}" rev-parse HEAD)"
fi

export DEV_HTTP_PORT="${HTTP_PORT}"
export DEPLOY_VERSION

# GitHub Environment 변수로 admin Mac의 Tailscale 주소를 주입할 수 있다.
# 값이 없으면 외부 env 파일 또는 Compose의 localhost 기본값을 사용한다.
if [[ -n "${IEOBOM_DEV_TAILSCALE_HOST:-}" ]]; then
  export DEV_MAILPIT_BIND_HOST="${IEOBOM_DEV_TAILSCALE_HOST}"
fi
if [[ -n "${IEOBOM_DEV_INVITATION_WEB_ORIGIN:-}" ]]; then
  export INVITATION_WEB_ORIGIN="${IEOBOM_DEV_INVITATION_WEB_ORIGIN}"
fi

if ! command -v docker >/dev/null 2>&1 && [[ -x /Applications/Docker.app/Contents/Resources/bin/docker ]]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:${PATH}"
fi

compose() {
  docker compose \
    --project-name "${PROJECT_NAME}" \
    --env-file "${ENV_FILE}" \
    --file "${COMPOSE_FILE}" \
    "$@"
}

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Deployment environment file not found: ${ENV_FILE}" >&2
  echo "Create it from envs/example.dev-mac.env outside the runner checkout." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI is not installed." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop is not running for the self-hosted runner user." >&2
  exit 1
fi

echo "Validating Compose configuration"
compose config --quiet

echo "Building application images for ${DEPLOY_VERSION}"
# Do not force a registry refresh on every dev deployment. BuildKit still
# downloads missing base images, while cached images keep deployments working
# through short Docker Hub or GHCR metadata outages.
compose build fastapi frontend

echo "Starting PostgreSQL and Redis"
compose up -d postgres redis

echo "Applying Alembic migrations once"
compose run --rm migrate

echo "Starting application services and development invitation inbox"
compose up -d --remove-orphans mailpit email-worker fastapi frontend nginx

echo "Waiting for http://127.0.0.1:${HTTP_PORT}/healthz"
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error "http://127.0.0.1:${HTTP_PORT}/healthz" >/dev/null; then
    break
  fi
  echo "Health check attempt ${attempt}/30 did not pass yet."
  sleep 2
done

if ! curl --fail --silent --show-error "http://127.0.0.1:${HTTP_PORT}/healthz" >/dev/null; then
  echo "Application deployment health check failed." >&2
  compose ps >&2
  compose logs --tail 200 fastapi frontend nginx migrate mailpit email-worker >&2
  exit 1
fi

mailpit_address="$(compose port mailpit 8025)"
echo "Waiting for Mailpit at http://${mailpit_address}"
for attempt in $(seq 1 15); do
  if curl --fail --silent --show-error "http://${mailpit_address}/" >/dev/null; then
    compose ps
    echo "Deployment completed: ${DEPLOY_VERSION}"
    exit 0
  fi
  echo "Mailpit health check attempt ${attempt}/15 did not pass yet."
  sleep 2
done

echo "Mailpit deployment health check failed." >&2
compose ps >&2
compose logs --tail 200 mailpit email-worker >&2
exit 1
