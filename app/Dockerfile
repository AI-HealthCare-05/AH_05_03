# 0. 프런트엔드 빌드. 별도 nginx 컨테이너를 두는 대신 산출물만 아래 단계로 옮긴다.
#    멀티스테이지라 최종 이미지에 node 는 남지 않는다 — dist 만 들어간다.
FROM node:22-alpine AS frontend

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


# 1. 의존성 설치 전용 단계. **uv 는 여기서만 산다.**
#
#    예전에는 이 단계가 없어서 `uv` 바이너리 55MB 가 런타임 이미지에 그대로
#    남아 있었다(`docker history` 실측). 빌드가 끝나면 쓸 일이 없는 물건이고,
#    venv 의 스크립트는 자기 shebang 으로 직접 실행되므로 `uv run` 도 필요 없다.
#
#    **`ghcr.io/astral-sh/uv` 태그를 고정한다.** `:latest` 는 빌드할 때마다 다른
#    바이너리를 가져올 수 있어 락파일을 쓰는 의미가 반감된다.
FROM python:3.13-slim AS deps

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.12.7 /uv /bin/uv

# `UV_COMPILE_BYTECODE` 로 .pyc 를 미리 굽는다 — 컨테이너 첫 요청이 빨라진다.
# `UV_NO_CACHE` 는 이 단계에 캐시를 남기지 않는다(어차피 venv 만 복사해 간다).
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1

# build-essential 등은 asyncmy를 컴파일하려고 있던 것이다.
# asyncpg는 manylinux 휠을 제공하므로 더 이상 필요 없다.
COPY pyproject.toml uv.lock ./
RUN uv sync --group app --no-dev --frozen


# 2. 런타임. uv 도 노드도 없고 venv 와 소스만 있다.
FROM python:3.13-slim

WORKDIR /app

# venv 를 PATH 앞에 둔다. 그래야 `uvicorn` · `alembic` · `python` 을 그냥 부를 수
# 있고, compose 의 `command:` 도 `uv run --no-sync` 접두어 없이 짧아진다.
# **WORKDIR 이 두 단계에서 같아야 한다** — venv 스크립트의 shebang 이 절대경로다.
ENV PATH="/app/.venv/bin:$PATH" \
    VIRTUAL_ENV=/app/.venv \
    PYTHONUNBUFFERED=1

COPY --from=deps /app/.venv /app/.venv

# alembic.ini 가 없으면 컨테이너 안에서 alembic upgrade 가
# "No config file 'alembic.ini' found" 로 실패한다.
COPY alembic.ini ./

COPY ./app ./app
# 규칙 기반 판정 엔진. AH_05_03 PR #4 에서 가져온 코드로 손대지 않는다.
# chronic_disease_engine/PROVENANCE.md 참조.
COPY ./chronic_disease_engine ./chronic_disease_engine

# 빌드된 SPA. `app/apis/spa.py` 의 FRONTEND_DIST 기본값과 같은 경로여야 한다.
COPY --from=frontend /frontend/dist ./static

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "3"]
