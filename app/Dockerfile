FROM python:3.13-slim

WORKDIR /app

# 로컬 보안 소프트웨어(Norton 등)가 TLS를 가로챌 때 쓰는 개인 루트 인증서.
# docker/certs/에 실제 .crt 파일이 있으면 컨테이너 신뢰 저장소에 추가한다.
# 파일이 없는 팀원 환경에서는 빈 디렉터리만 복사되고 아무 일도 일어나지 않는다.
COPY docker/certs/ /usr/local/share/ca-certificates/
RUN update-ca-certificates
ENV UV_SYSTEM_CERTS=1

# OCR 의존성이 요구하는 시스템 라이브러리.
# rapidocr-onnxruntime이 opencv-python(헤드리스가 아닌 쪽)을 끌어오므로
# libGL과 glib이 없으면 import 시점에 죽는다.
# asyncpg는 manylinux 휠을 제공하므로 컴파일러는 필요 없다.
RUN apt-get update \
    && apt-get install --no-install-recommends -y libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 1. uv 설치 (공식 이미지에서 복사해오는 가장 깔끔한 방법)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# 2. 의존성 패키지 관리 파일을 컨테이너 내부에 복사합니다.
#    alembic.ini가 없으면 컨테이너 안에서 alembic upgrade가
#    "No config file 'alembic.ini' found"로 실패한다.
COPY pyproject.toml uv.lock alembic.ini ./

# 3. app 그룹과 ocr 그룹만 설치합니다.
#    ocr 그룹의 rapidocr-onnxruntime은 ONNX 모델을 패키지에 동봉하고 있어
#    런타임에 외부 네트워크를 타지 않는다. 빌드 시점에 전부 확정된다.
#
#    캐시 마운트를 쓰는 이유가 둘이다.
#    - 재빌드가 빨라진다 (일반적인 이점)
#    - 다운로드가 중간에 끊겨도 성공분이 캐시에 남아 재시도가 앞으로 나아간다.
#      TLS를 가로채는 보안 프로그램이 깔린 개발 PC에서 큰 휠(opencv 60MB 등)이
#      간헐적으로 끊기는데, 캐시가 없으면 매번 처음부터 받는다.
ENV UV_LINK_MODE=copy
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --group app --group ocr --no-dev --frozen

# 4. 로컬 소스 코드를 컨테이너 내부로 복사합니다.
COPY ./app ./app

# 5. 해당 이미지를 활용하여 도커컨테이너 실행시 실행되는 명령어입니다.
# FastAPI를 uvicorn을 활용하여 비동기 환경으로 서버를 실행합니다.
# --no-sync 옵션은 uv run시 uv.lock파일과 환경에 설치된 패키지들을 비교하여 없는 패키지를 설치하기 때문에
# 불필요한 의존성을 설치하지 않기 위해 사용합니다.
# (--no-sync를 빼면 3단계에서 설치한 app·ocr 그룹을 uv가 걷어낸다.)
CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "3"]
