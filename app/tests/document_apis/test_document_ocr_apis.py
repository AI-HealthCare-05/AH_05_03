"""검진문서 OCR 계약 검증.

인식은 ai-worker가 큐로 받아 수행한다. 그래서 여기서 보는 것은
업로드 검증 · 큐 등록 · 워커 왕복 · 결과 조회 권한 · 경계 규칙이다.

실제 OCR 엔진은 부르지 않는다. 무겁고 느리며, 엔진 자체의 정확도는
`frontend/fixtures`를 쓰는 별도 채점 스크립트가 담당한다. 대신 워커는
진짜로 돌린다. 큐에 넣은 것이 실제로 처리돼 결과로 돌아오는지가
이 계약에서 가장 깨지기 쉬운 부분이기 때문이다.
"""

import io
from collections.abc import Iterator

import pytest
from fakeredis.aioredis import FakeRedis
from httpx import AsyncClient
from starlette import status

from ai_worker.consumer import Worker
from ai_worker.tasks import ocr as ocr_task
from app.apis.v1.document_routers import document_router  # noqa: F401  라우터 등록 확인
from app.services.ocr.engine import OcrToken


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


def _fake_tokens() -> list[OcrToken]:
    """RapidOCR 출력 모양을 그대로 흉내낸 두 행."""

    def t(text: str, conf: float, left: float, top: float) -> OcrToken:
        return OcrToken(text=text, confidence=conf, left=left, right=left + 80, top=top, bottom=top + 40)

    return [
        t("2026-03-11", 0.99, 1170, 20),
        t("트리글리세라이드", 0.95, 250, 100),
        t("98", 1.0, 1100, 100),
        t("mg/dL", 1.0, 1300, 100),
        t("0~150", 1.0, 1740, 100),
        t("引", 0.40, 250, 200),
        t("236", 1.0, 1100, 200),
        t("mg/dL", 1.0, 1300, 200),
        t("0~200", 1.0, 1740, 200),
    ]


class _StubEngine:
    id = "stub"
    version = "test"

    def __init__(self, tokens: list[OcrToken]) -> None:
        self._tokens = tokens

    async def recognize(self, image: bytes) -> list[OcrToken]:
        return self._tokens


@pytest.fixture
def stub_ocr(request: pytest.FixtureRequest) -> Iterator[None]:
    """워커가 쓰는 엔진만 갈아끼운다. 업로드 검증과 행 조립은 그대로 태운다."""
    tokens = getattr(request, "param", None)
    tokens = _fake_tokens() if tokens is None else tokens

    original = ocr_task._service._engine
    ocr_task._service._engine = _StubEngine(tokens)  # type: ignore[assignment]
    yield
    ocr_task._service._engine = original


def _png(width: int, height: int) -> bytes:
    """흰 배경 PNG. 해상도 가드를 태우기 위한 최소 이미지."""
    import struct
    import zlib

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    raw = b"".join(b"\x00" + b"\xff" * (width * 3) for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def _wide_png() -> bytes:
    """짧은 변 900px 이상 — 해상도 가드를 통과한다."""
    return _png(1000, 1000)


async def _upload(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post(
        "/api/v1/documents/ocr", headers=headers, files={"file": ("a.png", io.BytesIO(_wide_png()), "image/png")}
    )
    assert response.status_code == status.HTTP_202_ACCEPTED
    return str(response.json()["data"]["job_id"])


class TestDocumentOcrUpload:
    async def test_returns_401_without_token(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/documents/ocr", files={"file": ("a.png", io.BytesIO(_wide_png()), "image/png")}
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_returns_415_for_non_image(self, client: AsyncClient) -> None:
        headers = await _login(client, "ocr-type@example.com")
        response = await client.post(
            "/api/v1/documents/ocr", headers=headers, files={"file": ("a.txt", io.BytesIO(b"nope"), "text/plain")}
        )
        assert response.status_code == status.HTTP_415_UNSUPPORTED_MEDIA_TYPE
        assert response.json()["error_code"] == "DOCUMENT_UNSUPPORTED_TYPE"

    async def test_returns_422_with_required_size_when_resolution_is_low(self, client: AsyncClient) -> None:
        """검증은 큐에 넣기 전에 끝난다. 못 쓸 파일은 워커까지 가지 않는다."""
        headers = await _login(client, "ocr-small@example.com")
        small = _png(400, 300)
        response = await client.post(
            "/api/v1/documents/ocr", headers=headers, files={"file": ("a.png", io.BytesIO(small), "image/png")}
        )
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
        body = response.json()
        assert body["error_code"] == "DOCUMENT_RESOLUTION_TOO_LOW"
        assert "900px" in body["message"]

    async def test_accepts_upload_and_reports_queued(self, client: AsyncClient) -> None:
        headers = await _login(client, "ocr-queued@example.com")
        response = await client.post(
            "/api/v1/documents/ocr", headers=headers, files={"file": ("a.png", io.BytesIO(_wide_png()), "image/png")}
        )
        assert response.status_code == status.HTTP_202_ACCEPTED
        data = response.json()["data"]
        assert data["status"] == "queued"
        assert data["result"] is None

        polled = await client.get(f"/api/v1/documents/ocr/{data['job_id']}", headers=headers)
        assert polled.status_code == status.HTTP_200_OK
        assert polled.json()["data"]["status"] == "queued"


class TestDocumentOcrResult:
    async def test_returns_values_and_review_flags_after_worker_runs(
        self, client: AsyncClient, fake_redis: FakeRedis, stub_ocr: None
    ) -> None:
        headers = await _login(client, "ocr-ok@example.com")
        job_id = await _upload(client, headers)

        assert await Worker(fake_redis).drain_once() == 1

        response = await client.get(f"/api/v1/documents/ocr/{job_id}", headers=headers)
        assert response.status_code == status.HTTP_200_OK
        body = response.json()["data"]
        assert body["status"] == "succeeded"

        data = body["result"]
        assert data["engine"] == "stub"
        assert data["measured_date"] == "2026-03-11"
        assert data["image_discarded"] is True

        by_code = {r["item_code"]: r for r in data["rows"]}
        assert by_code["triglyceride"]["value"] == 98
        assert by_code["triglyceride"]["needs_review"] is False
        # 한글이 깨진 행은 값은 읽히지만 신뢰도가 낮아 검수로 넘어간다
        assert by_code["total_cholesterol"]["value"] == 236
        assert by_code["total_cholesterol"]["needs_review"] is True
        assert data["auto_confirmable"] + data["needs_review"] == len(data["rows"])

    @pytest.mark.parametrize("stub_ocr", [[]], indirect=True)
    async def test_reports_failure_when_nothing_recognized(
        self, client: AsyncClient, fake_redis: FakeRedis, stub_ocr: None
    ) -> None:
        """워커가 올린 도메인 오류가 코드 그대로 조회 응답에 실린다."""
        headers = await _login(client, "ocr-empty@example.com")
        job_id = await _upload(client, headers)

        await Worker(fake_redis).drain_once()

        response = await client.get(f"/api/v1/documents/ocr/{job_id}", headers=headers)
        body = response.json()["data"]
        assert body["status"] == "failed"
        assert body["error_code"] == "OCR_NO_RESULT"
        assert body["result"] is None

    async def test_other_account_cannot_read_the_result(
        self, client: AsyncClient, fake_redis: FakeRedis, stub_ocr: None
    ) -> None:
        """결과에 건강정보가 들어간다. job_id를 아는 것만으로는 못 읽는다."""
        owner = await _login(client, "ocr-owner@example.com")
        job_id = await _upload(client, owner)
        await Worker(fake_redis).drain_once()

        stranger = await _login(client, "ocr-stranger@example.com")
        response = await client.get(f"/api/v1/documents/ocr/{job_id}", headers=stranger)
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert response.json()["error_code"] == "JOB_NOT_FOUND"

    async def test_unknown_job_is_not_found(self, client: AsyncClient) -> None:
        headers = await _login(client, "ocr-missing@example.com")
        response = await client.get("/api/v1/documents/ocr/00000000-0000-4000-8000-000000000000", headers=headers)
        assert response.status_code == status.HTTP_404_NOT_FOUND


class TestDocumentOcrBoundary:
    async def test_worker_discards_the_image_after_processing(
        self, client: AsyncClient, fake_redis: FakeRedis, stub_ocr: None
    ) -> None:
        """건강정보 경계 검증. 이미지가 큐에 남아 있으면 안 된다."""
        headers = await _login(client, "ocr-discard@example.com")
        job_id = await _upload(client, headers)

        assert await fake_redis.exists(f"{_prefix()}:jobs:payload:{job_id}") == 1
        await Worker(fake_redis).drain_once()
        assert await fake_redis.exists(f"{_prefix()}:jobs:payload:{job_id}") == 0

    async def test_response_carries_no_image_or_raw_text(
        self, client: AsyncClient, fake_redis: FakeRedis, stub_ocr: None
    ) -> None:
        """응답에 이미지 바이트나 base64가 섞이면 안 된다."""
        headers = await _login(client, "ocr-boundary@example.com")
        job_id = await _upload(client, headers)
        await Worker(fake_redis).drain_once()

        body = (await client.get(f"/api/v1/documents/ocr/{job_id}", headers=headers)).text
        assert "PNG" not in body
        assert "base64" not in body
        for key in ("image", "file", "content", "raw_text"):
            assert f'"{key}"' not in body


def _prefix() -> str:
    from app.core import config

    return config.REDIS_KEY_PREFIX
