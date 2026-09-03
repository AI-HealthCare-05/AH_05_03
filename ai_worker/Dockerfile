# 예측 작업 소비자 이미지.
#
# **`app/` 을 함께 담는 이유가 이 파일의 핵심이다.** 워커는 채점을
# `app.services.prediction.build_prediction` 으로 하는데, 동기 라우터가 부르는 것과 같은
# 함수여야 한다. 두 벌로 두면 같은 입력에 다른 답이 나올 수 있고 그건 설명할 수 없다.
#
# 의존성은 `app` 그룹이다. 원래 `ai` 그룹(`torch`·`torchvision`·`torchaudio`·
# `sentence-transformers`)을 설치했는데 채점은 JSON 계수와 순수 파이썬 내적이라
# 그 무게가 전혀 필요 없다. 챗봇·임베딩 작업을 이 워커에 얹을 때 다시 본다.
#
# SPA 는 담지 않는다. 워커는 HTTP 를 서빙하지 않으므로 `app/Dockerfile` 의 node
# 스테이지가 필요 없고, 그만큼 이미지가 작고 빌드가 빠르다.

FROM python:3.13-slim

WORKDIR /app

# 1. uv 설치 (공식 이미지에서 복사해오는 가장 깔끔한 방법)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# 2. 의존성 패키지 관리 파일을 컨테이너 내부에 복사합니다.
COPY pyproject.toml uv.lock ./

# 3. FastAPI 와 같은 의존성 집합. 채점 코드를 공유하므로 그룹도 같아야 한다.
RUN uv sync --group app --no-dev --frozen

# 4. 소스. `app` 은 채점·큐 계약, `ai_worker` 는 소비자 루프,
#    `chronic_disease_engine` 은 규칙 판정(수정 금지 이식본)이다.
COPY ./app ./app
COPY ./ai_worker ./ai_worker
COPY ./chronic_disease_engine ./chronic_disease_engine

# 5. 소비자 루프. `--scale ai-worker=3` 으로 여러 대를 띄워도 같은 명령이다 —
#    소비자 그룹이 작업을 나눠 주므로 코드에 분배 로직이 없다.
CMD ["uv", "run", "--no-sync", "python", "-m", "ai_worker.main"]
