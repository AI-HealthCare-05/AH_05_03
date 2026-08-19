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
compose build --pull fastapi frontend

echo "Starting PostgreSQL and Redis"
compose up -d postgres redis

echo "Applying Alembic migrations once"
compose run --rm migrate

echo "Starting application services"
compose up -d --remove-orphans fastapi frontend nginx

echo "Waiting for http://127.0.0.1:${HTTP_PORT}/healthz"
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error "http://127.0.0.1:${HTTP_PORT}/healthz" >/dev/null; then
    compose ps
    echo "Deployment completed: ${DEPLOY_VERSION}"
    exit 0
  fi
  echo "Health check attempt ${attempt}/30 did not pass yet."
  sleep 2
done

echo "Deployment health check failed." >&2
compose ps >&2
compose logs --tail 200 fastapi frontend nginx migrate >&2
exit 1
