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
if [[ -n "${IEOBOM_DEV_CORS_ALLOW_ORIGINS:-}" ]]; then
  export CORS_ALLOW_ORIGINS="${IEOBOM_DEV_CORS_ALLOW_ORIGINS}"
fi
if [[ -n "${IEOBOM_DEV_REFRESH_COOKIE_SECURE:-}" ]]; then
  export REFRESH_COOKIE_SECURE="${IEOBOM_DEV_REFRESH_COOKIE_SECURE}"
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

app_changed=false
assets_changed=false
migrations_changed=false
force_deploy="${DEPLOY_FORCE:-0}"
before_sha="${DEPLOY_BEFORE_SHA:-}"

if [[ "${force_deploy}" == "1" ]] || ! git -C "${ROOT_DIR}" cat-file -e "${before_sha}^{commit}" 2>/dev/null; then
  app_changed=true
  assets_changed=true
  migrations_changed=true
else
  while IFS= read -r changed_path; do
    case "${changed_path}" in
      frontend/public/vendor/vanatome/*)
        assets_changed=true
        ;;
      app/core/db/migrations/*|alembic.ini)
        app_changed=true
        migrations_changed=true
        ;;
      app/*|chronic_disease_engine/*|frontend/*|pyproject.toml|uv.lock)
        app_changed=true
        ;;
      infra/*|scripts/deploy_admin_mac.sh)
        app_changed=true
        assets_changed=true
        migrations_changed=true
        ;;
    esac
  done < <(git -C "${ROOT_DIR}" diff --name-only "${before_sha}" "${DEPLOY_VERSION}")
fi

# 새 Mac 또는 Docker 정리 직후에는 변경 판별과 무관하게 필요한 이미지를 만든다.
if ! docker image inspect ieobom-dev-fastapi:current >/dev/null 2>&1; then
  app_changed=true
  migrations_changed=true
fi
if ! docker image inspect ieobom-dev-anatomy-assets:current >/dev/null 2>&1; then
  assets_changed=true
fi

rotate_image_tags() {
  local repository="$1"
  if docker image inspect "${repository}:rollback-1" >/dev/null 2>&1; then
    docker tag "${repository}:rollback-1" "${repository}:rollback-2"
  fi
  if docker image inspect "${repository}:current" >/dev/null 2>&1; then
    docker tag "${repository}:current" "${repository}:rollback-1"
  fi
}

remove_legacy_image_tags() {
  local repository="$1"
  local image_ref
  while IFS= read -r image_ref; do
    case "${image_ref}" in
      "${repository}:current"|"${repository}:rollback-1"|"${repository}:rollback-2") ;;
      "${repository}:<none>"|"") ;;
      *) docker image rm "${image_ref}" >/dev/null 2>&1 || true ;;
    esac
  done < <(docker image ls "${repository}" --format '{{.Repository}}:{{.Tag}}')
}

build_services=()
if [[ "${app_changed}" == true ]]; then
  rotate_image_tags ieobom-dev-fastapi
  build_services+=(fastapi)
fi
if [[ "${assets_changed}" == true ]]; then
  rotate_image_tags ieobom-dev-anatomy-assets
  build_services+=(anatomy-assets)
fi

if (( ${#build_services[@]} )); then
  echo "Building changed images: ${build_services[*]}"
  compose build "${build_services[@]}"
else
  echo "No application image changed; reusing current images"
fi

echo "Starting PostgreSQL and Redis"
compose up -d postgres redis

if [[ "${migrations_changed}" == true ]]; then
  echo "Applying Alembic migrations"
  compose run --rm migrate
else
  echo "Migration files unchanged; skipping Alembic startup"
fi

echo "Ensuring the pinned Mailpit image exists"
# A non-interactive self-hosted runner can block indefinitely while Docker
# Desktop waits for its macOS credential helper. Mailpit is a public image, so
# resolve the Compose-selected image first and pull it with an empty temporary
# Docker config. Keep the current daemon endpoint explicit because Docker
# contexts live under the normal Docker config directory.
mailpit_image="$(compose config --images mailpit)"
docker_host="$(docker context inspect "$(docker context show)" --format '{{.Endpoints.docker.Host}}')"
if ! docker image inspect "${mailpit_image}" >/dev/null 2>&1; then
  anonymous_docker_config="$(mktemp -d "${TMPDIR:-/tmp}/ieobom-docker-config.XXXXXX")"
  trap 'rm -rf "${anonymous_docker_config}"' EXIT
  printf '{"auths":{}}\n' > "${anonymous_docker_config}/config.json"
  docker --config "${anonymous_docker_config}" --host "${docker_host}" pull "${mailpit_image}"
else
  echo "Mailpit image is already present; skipping pull"
fi

echo "Starting application services and development invitation inbox"
compose up -d --remove-orphans mailpit email-worker fastapi anatomy-assets

# The nginx image resolves Docker service names when nginx starts. Reusing an
# existing nginx container after frontend or FastAPI is recreated can leave it
# proxying to the old container IP and returning 502 despite healthy services.
if [[ "${app_changed}" == true ]] || [[ "${assets_changed}" == true ]]; then
  echo "Recreating nginx to refresh changed Docker upstream addresses"
  compose up -d --no-deps --force-recreate nginx
else
  compose up -d --no-deps nginx
fi

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
  compose logs --tail 200 fastapi anatomy-assets nginx migrate mailpit email-worker >&2
  exit 1
fi

mailpit_address="$(compose port mailpit 8025)"
echo "Waiting for Mailpit at http://${mailpit_address}"
for attempt in $(seq 1 15); do
  if curl --fail --silent --show-error "http://${mailpit_address}/" >/dev/null; then
    compose ps
    # current + rollback-1 + rollback-2 태그만 유지한다. 아래 prune은 그보다
    # 오래된 dangling 프로젝트 이미지만 지우며 볼륨과 타 프로젝트는 건드리지 않는다.
    docker image prune --force --filter "label=com.ieobom.service=fastapi" --filter "until=24h" >/dev/null
    docker image prune --force --filter "label=com.ieobom.service=anatomy-assets" --filter "until=24h" >/dev/null
    remove_legacy_image_tags ieobom-dev-fastapi
    remove_legacy_image_tags ieobom-dev-frontend
    remove_legacy_image_tags ieobom-dev-anatomy-assets
    state_dir="${HOME}/.local/state/ieobom-deploy"
    prune_marker="${state_dir}/last-build-cache-prune"
    mkdir -p "${state_dir}"
    if [[ ! -f "${prune_marker}" ]] || [[ -n "$(find "${prune_marker}" -mtime +6 -print 2>/dev/null)" ]]; then
      docker builder prune --force --filter "until=168h" --keep-storage 20GB >/dev/null || true
      touch "${prune_marker}"
    fi
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
