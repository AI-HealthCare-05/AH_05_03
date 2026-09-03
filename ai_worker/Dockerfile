FROM python:3.13-slim

WORKDIR /app

# 로컬 보안 소프트웨어(Norton 등)가 TLS를 가로챌 때 쓰는 개인 루트 인증서.
# docker/certs/에 실제 .crt 파일이 있으면 컨테이너 신뢰 저장소에 추가한다.
# 파일이 없는 팀원 환경에서는 빈 디렉터리만 복사되고 아무 일도 일어나지 않는다.
COPY docker/certs/ /usr/local/share/ca-certificates/
RUN update-ca-certificates
ENV UV_SYSTEM_CERTS=1

# OCR 작업이 rapidocr-onnxruntime을 쓰고, 그것이 opencv-python(헤드리스가 아닌
# 쪽)을 끌어온다. libGL과 glib이 없으면 import 시점에 죽는다. app 이미지와 같다.
RUN apt-get update \
    && apt-get install --no-install-recommends -y libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 1. uv 설치 (공식 이미지에서 복사해오는 가장 깔끔한 방법)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# 2. 의존성 패키지 관리 파일을 컨테이너 내부에 복사합니다.
COPY pyproject.toml uv.lock ./

# 3. ai 그룹에 더해 app·ocr 그룹도 설치한다.
#    워커가 app.services.documents의 인식 로직과 app.core.jobs의 큐 계약을
#    그대로 재사용하기 때문이다. 같은 코드를 두 벌 두면 API 응답과 워커
#    결과가 갈라진다.
#    캐시 마운트를 쓰는 이유: TLS를 가로채는 보안 프로그램(Norton 등)이 깔린 개발 PC에서
#    다운로드가 간헐적으로 끊기는데, 캐시가 없으면 재시도할 때마다 처음부터 다시 받는다.
ENV UV_LINK_MODE=copy
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --group ai --group app --group ocr --no-dev --frozen

# 4. 로컬 소스 코드를 컨테이너 내부로 복사합니다.
#    의존 방향은 ai_worker -> app 한쪽이다. app은 ai_worker를 import하지 않는다.
COPY ./app ./app
COPY ./ai_worker ./ai_worker

# 5. 워커를 실행합니다.
#    --no-sync가 없으면 uv가 3단계에서 설치한 그룹을 걷어내고 기본 그룹으로
#    되돌린다. 그러면 OCR·큐 import에서 죽는다.
CMD ["uv", "run", "--no-sync", "python", "-m", "ai_worker.main"]
