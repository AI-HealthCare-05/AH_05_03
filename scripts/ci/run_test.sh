#!/bin/bash
set -eo pipefail

COLOR_GREEN=$(tput setaf 2)
COLOR_BLUE=$(tput setaf 4)
COLOR_RED=$(tput setaf 1)
COLOR_NC=$(tput sgr0)

cd "$(dirname "$0")/../.."

source .env

echo "${COLOR_BLUE}Find Tests${COLOR_NC}"

HAS_TESTS=false
PG_CONTAINER_NAME=postgres

if [ -d "./app/tests" ] && find ./app/tests -name 'test_*.py' -print -quit | read ; then
  HAS_TESTS=true
fi

echo "Has tests: $HAS_TESTS"

if [ "$HAS_TESTS" = true ]; then
  if docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER_NAME}$"; then
    # POSTGRES_USER가 클러스터 슈퍼유저라 CREATE DATABASE 권한이 이미 있다.
    # MySQL 시절 이 자리에 있던 GRANT 해킹이 필요 없어졌다.
    echo "${COLOR_BLUE}→ Postgres container found. Waiting for readiness...${COLOR_NC}"
    docker exec -i ${PG_CONTAINER_NAME} pg_isready -U "${DB_USER}" -d "${DB_NAME}" > /dev/null

    echo "${COLOR_BLUE}Apply Migrations${COLOR_NC}"
    if ! uv run alembic upgrade head; then
      echo "${COLOR_RED}✖ Migration failed.${COLOR_NC}"
      exit 1
    fi

    echo "${COLOR_BLUE}Run Pytest with Coverage${COLOR_NC}"

    if ! uv run coverage run -m pytest app; then
      echo ""
      echo "${COLOR_RED}✖ Pytest failed.${COLOR_NC}"
      echo "${COLOR_RED}→ Fix the test failures above and re-run.${COLOR_NC}"
      exit 1
    fi

    echo "${COLOR_BLUE}Coverage Report${COLOR_NC}"
    if ! uv run coverage report -m ; then
      echo "${COLOR_RED}✖ Coverage check failed.${COLOR_NC}"
      exit 1
    fi

    echo "${COLOR_GREEN}✔ Tests passed.${COLOR_NC}"
  else
    # 예전에는 여기서 exit 0이라 DB가 없으면 CI가 조용히 초록이었다.
    echo "${COLOR_RED} Postgres Docker Container Not Found. Run docker compose up -d postgres.${COLOR_NC}"
    exit 1
  fi
else
  echo "${COLOR_BLUE}No tests found. Skipping tests.${COLOR_NC}"
fi
