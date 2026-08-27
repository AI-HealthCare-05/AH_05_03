"""문서 인식 라우터 — 동기 경로와 큐 경로.

## 흐름

    nginx → FastAPI → Redis(큐) → ai-worker → Gemini
                          ↑                      │
                          └──── 결과 되쓰기 ──────┘

제품 화면은 큐 경로(`POST /jobs` → `GET /jobs/{id}`)를 쓴다. Gemini 왕복이 수십 초까지
걸려서 동기로 매달면 nginx 타임아웃과 사용자 대기가 함께 늘어난다.

동기 경로(`POST /recognize`)를 지우지 않았다. 예측 축이 `/predictions/risk`(동기)와
`/predictions/jobs`(비동기)를 함께 두고 **둘의 결과가 바이트 단위로 같음**을 근거로
쓰는 것과 같은 구성이다. 두 경로가 같은 `recognize_parts` 를 부르므로 갈릴 수 없다.
"""

import asyncio
import base64
import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from fastapi.responses import StreamingResponse

from app.core import config
from app.core.errors import ErrorCode
from app.core.jobs import OCR_TERMINAL_STATUSES, OcrJobStatus, OcrJobStore
from app.core.jobs.ocr_contract import CHUNK_KIND_DELTA, CHUNK_KIND_RESET
from app.dependencies.security import require_active_account
from app.dependencies.services import get_rate_limiter
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.ocr import OcrJobAcceptedData, OcrJobStatusData, RawOcrData
from app.exceptions import (
    OcrFileTooLargeError,
    OcrJobNotFoundError,
    OcrNoFileError,
    OcrUnavailableError,
)
from app.models.service_accounts import ServiceAccount
from app.services.dev_ocr import DevOcrService, read_uploads
from app.services.rate_limit import RateLimiter

dev_ocr_router = APIRouter(prefix="/dev/ocr", tags=["development-ocr"])

_ERRORS = (
    # 503 은 우리 쪽 사정(브리지 꺼짐·키 없음)일 때만. 사용자가 잘못 올린 것과
    # 외부 공급자 실패는 아래 코드로 갈라진다 — 이유는 `app/core/errors.py` 참조.
    ErrorCode.OCR_UNAVAILABLE,
    ErrorCode.OCR_NO_FILE,
    ErrorCode.OCR_UNSUPPORTED_TYPE,
    ErrorCode.OCR_FILE_TOO_LARGE,
    ErrorCode.OCR_PROVIDER_FAILED,
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.AUTH_REQUIRED,
    ErrorCode.TOKEN_INVALID,
    ErrorCode.TOKEN_EXPIRED,
    ErrorCode.RATE_LIMITED,
)


def _collect(file: UploadFile | None, files: list[UploadFile] | None) -> list[UploadFile]:
    target = files or ([file] if file else [])
    if not target:
        raise OcrNoFileError("인식할 파일이 제공되지 않았습니다.")
    return target


async def _guard(limiter: RateLimiter, account: ServiceAccount) -> None:
    """외부 유료 API 를 부르는 경로다. 인증만으로는 부족하고 계정별 상한이 있어야
    한 계정이 조용히 할당량을 태우는 것을 막는다."""
    await limiter.hit(
        "dev-ocr",
        str(account.id),
        config.DEV_OCR_RATE_LIMIT,
        config.DEV_OCR_RATE_WINDOW_SECONDS,
    )


@dev_ocr_router.post(
    "/jobs",
    response_model=ApiResponse[OcrJobAcceptedData],
    status_code=status.HTTP_202_ACCEPTED,
    responses=error_responses(*_ERRORS, ErrorCode.SERVICE_UNAVAILABLE),
    summary="문서 인식 작업 등록 (큐)",
    description="원본을 Redis 에 싣고 ai-worker 가 처리한다. 결과는 GET /dev/ocr/jobs/{job_id} 로 받는다.",
)
async def enqueue_job(
    request: Request,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
    file: Annotated[UploadFile | None, File(description="단일 건강서류 이미지 또는 PDF")] = None,
    files: Annotated[list[UploadFile] | None, File(description="복수 건강서류 이미지 또는 PDF")] = None,
) -> ApiResponse[OcrJobAcceptedData]:
    await _guard(limiter, account)
    if not config.ENABLE_DEV_OCR_BRIDGE:
        raise OcrUnavailableError("개발용 OCR 브리지가 비활성화되어 있습니다.")

    # 검증은 **생산자가 한다.** 형식·크기가 틀린 것을 큐에 실으면 워커가 반드시
    # 실패하고, 사용자는 그 사실을 수십 초 뒤에야 알게 된다.
    collected = await read_uploads(_collect(file, files))
    total = sum(len(content) for content, _ in collected)
    if total > config.DEV_OCR_JOB_MAX_TOTAL_BYTES:
        raise OcrFileTooLargeError("한 번에 올릴 수 있는 총 용량을 넘었습니다.")

    store = OcrJobStore(request.app.state.redis)
    # base64 로 싣는 이유는 `ocr_contract.py` 참조 — Redis 연결이 텍스트 모드다.
    job_id = await store.enqueue(
        {"files": [{"mime": mime, "b64": base64.b64encode(content).decode()} for content, mime in collected]}
    )
    return ApiResponse(
        data=OcrJobAcceptedData(
            job_id=job_id,
            status=OcrJobStatus.QUEUED.value,
            poll_after_ms=config.DEV_OCR_JOB_STREAM_BLOCK_MS,
        ),
        message="문서 인식 작업을 등록했습니다.",
    )


@dev_ocr_router.get(
    "/jobs/{job_id}",
    response_model=ApiResponse[OcrJobStatusData],
    responses=error_responses(*_ERRORS, ErrorCode.OCR_JOB_NOT_FOUND),
    summary="문서 인식 작업 상태",
)
async def read_job(
    job_id: str,
    request: Request,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
) -> ApiResponse[OcrJobStatusData]:
    store = OcrJobStore(request.app.state.redis)
    fields = await store.read(job_id)
    if fields is None:
        # TTL 이 지났거나 없는 작업. 어느 쪽인지 구분해 알려 주지 않는다 — 무작위
        # job_id 를 긁어 남의 작업 존재 여부를 알아내는 것을 막는다.
        raise OcrJobNotFoundError("작업을 찾을 수 없습니다. 시간이 지나 정리됐을 수 있습니다.")

    raw_result = fields.get("result")
    status_value = fields.get("status", OcrJobStatus.QUEUED.value)
    return ApiResponse(
        data=OcrJobStatusData(
            job_id=job_id,
            status=status_value,
            created_at=fields.get("created_at"),
            started_at=fields.get("started_at"),
            finished_at=fields.get("finished_at"),
            attempts=int(fields.get("attempts", 0) or 0),
            error=fields.get("error"),
            result=RawOcrData(**json.loads(raw_result)) if raw_result else None,
        ),
        message=(
            "문서 인식이 끝났습니다."
            if status_value in {s.value for s in OCR_TERMINAL_STATUSES}
            else "아직 처리 중입니다."
        ),
    )


#: SSE 폴링 간격. 워커가 청크를 Redis 에 싣는 속도보다 촘촘할 이유가 없다.
_SSE_POLL_SECONDS = 0.25
#: 이만큼 아무 일도 없으면 주석 한 줄을 보내 연결을 살려 둔다. nginx·브라우저·중간
#: 프록시가 조용한 연결을 끊는 것을 막는다.
_SSE_KEEPALIVE_SECONDS = 15.0
#: 전체 상한. 워커가 죽어 영영 안 끝나는 작업에 연결을 매달아 두지 않는다.
#: 프런트의 `MAX_WAIT_MS`(180초)와 같은 값이다.
_SSE_MAX_SECONDS = 180.0


def _sse(event: str, payload: dict) -> str:
    """SSE 한 프레임. `data` 는 **한 줄이어야 한다** — 인식 텍스트에 줄바꿈이 잔뜩
    들어 있으므로 그대로 쓰면 프레임이 중간에서 끝난다. JSON 이 `\\n` 으로 이스케이프해
    주므로 한 줄이 보장된다."""
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n\n"


@dev_ocr_router.get(
    "/jobs/{job_id}/stream",
    responses=error_responses(*_ERRORS, ErrorCode.OCR_JOB_NOT_FOUND),
    summary="문서 인식 진행 상황 (SSE)",
    description=(
        "워커가 Gemini 에서 받는 청크를 실시간으로 중계한다. 폴링(`GET /jobs/{job_id}`)을 "
        "대체하지 않고 나란히 둔다 — 스트리밍이 막히는 환경에서도 화면이 동작해야 한다.\n\n"
        "이벤트는 넷이다.\n"
        '- `delta` — `{"text": "..."}` 새로 인식된 글자. 이어 붙이면 된다\n'
        "- `reset` — 앞 모델이 실패해 다시 시작했다. 지금까지 붙인 것을 지운다\n"
        '- `done` — `{"result": {...}}` 폴링 응답의 `result` 와 같은 모양\n'
        '- `error` — `{"error": "..."}` 확정 실패'
    ),
)
async def stream_job(
    job_id: str,
    request: Request,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
) -> StreamingResponse:
    """진행 상황 SSE 중계.

    ## 왜 워커가 아니라 여기서 흘리는가

    Gemini 를 부르는 것은 워커다. 워커는 HTTP 를 서빙하지 않으므로 브라우저와 직접
    이어질 수 없다. 그래서 워커는 청크를 Redis 스트림에 싣고 이 라우터가 읽어 중계한다.
    큐·재시도·회수·여러 대 확장이 전부 그대로 살아 있는 것이 이 구조의 값이다.

    ## 인증

    `EventSource` 는 헤더를 못 붙이므로 프런트는 `fetch` + `ReadableStream` 으로 읽는다.
    그래야 `Authorization` 이 실리고 토큰 갱신도 기존 클라이언트가 그대로 처리한다.
    쿼리스트링에 토큰을 실어 `EventSource` 를 쓰는 방법도 있지만, 토큰이 nginx
    액세스 로그와 브라우저 히스토리에 남는다.
    """
    _ = account
    store = OcrJobStore(request.app.state.redis)
    # 없는 작업에 연결을 열어 두지 않는다. 여기서 확인해야 404 를 **SSE 프레임이 아니라
    # 오류 봉투로** 돌려줄 수 있다 — 200 으로 스트림을 연 뒤 오류를 알리면 프런트의
    # 공통 오류 처리가 안 걸린다.
    if await store.read(job_id) is None:
        raise OcrJobNotFoundError("작업을 찾을 수 없습니다. 시간이 지나 정리됐을 수 있습니다.")

    return StreamingResponse(
        _relay(store, job_id, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # nginx 가 프록시 응답을 모아 두면 청크가 한꺼번에 나가 스트리밍이
            # 아무 의미가 없어진다. `default.conf` 에도 `proxy_buffering off` 가
            # 있지만 앱이 스스로 밝혀 두면 설정이 어긋나도 살아 있다.
            "X-Accel-Buffering": "no",
        },
    )


def _terminal_frame(fields: dict[str, str] | None) -> str | None:
    """작업이 끝났으면 닫는 프레임, 아직이면 None.

    `done` 의 `result` 는 폴링 응답(`GET /jobs/{job_id}`)의 `result` 와 **같은 모양**이다.
    화면이 두 경로를 오가도 같은 파서를 쓸 수 있어야 한다.
    """
    if fields is None:
        # TTL 이 지나 작업이 통째로 사라졌다.
        return _sse("error", {"error": "EXPIRED"})
    status_value = fields.get("status", OcrJobStatus.QUEUED.value)
    if status_value == OcrJobStatus.SUCCEEDED.value:
        raw_result = fields.get("result")
        return _sse("done", {"result": json.loads(raw_result) if raw_result else None})
    if status_value == OcrJobStatus.FAILED.value:
        return _sse("error", {"error": fields.get("error") or "RECOGNITION_FAILED"})
    return None


async def _relay(store: OcrJobStore, job_id: str, request: Request) -> AsyncIterator[str]:
    """Redis 조각을 SSE 프레임으로 옮긴다.

    **조각을 먼저 비우고 상태를 본다.** 순서를 뒤집으면 마지막 청크가 실린 직후 상태가
    `succeeded` 로 바뀐 경우 그 청크를 못 보고 끝난다 — 글의 마지막 문장이 잘린다.
    """
    last_id = "0"
    idle = 0.0
    elapsed = 0.0
    # 재연결이면 지금까지 실린 조각을 처음부터 다시 보낸다. 프런트는 `reset` 을
    # 받으면 지우므로, 중간에 모델이 바뀐 이력까지 그대로 재생된다.
    while True:
        if await request.is_disconnected():
            return

        for message_id, kind, text in await store.read_chunks(job_id, last_id):
            last_id = message_id
            idle = 0.0
            if kind == CHUNK_KIND_DELTA and text:
                yield _sse("delta", {"text": text})
            elif kind == CHUNK_KIND_RESET:
                yield _sse("reset", {})

        closing = _terminal_frame(await store.read(job_id))
        if closing is not None:
            yield closing
            return

        await asyncio.sleep(_SSE_POLL_SECONDS)
        idle += _SSE_POLL_SECONDS
        elapsed += _SSE_POLL_SECONDS
        if elapsed >= _SSE_MAX_SECONDS:
            yield _sse("error", {"error": "TIMEOUT"})
            return
        if idle >= _SSE_KEEPALIVE_SECONDS:
            idle = 0.0
            # 주석 프레임. 브라우저는 무시하고 중간 프록시는 살아 있다고 본다.
            yield ": keepalive\n\n"


@dev_ocr_router.post(
    "/recognize",
    response_model=ApiResponse[RawOcrData],
    responses=error_responses(*_ERRORS),
    summary="개발용 원시 OCR 실행 (동기)",
    description="큐를 거치지 않고 즉시 인식한다. 비동기 경로와 같은 함수를 부르므로 결과가 갈리지 않는다.",
)
async def recognize_document(
    service: Annotated[DevOcrService, Depends(DevOcrService)],
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
    file: Annotated[UploadFile | None, File(description="단일 건강서류 이미지 또는 PDF")] = None,
    files: Annotated[list[UploadFile] | None, File(description="복수 건강서류 이미지 또는 PDF")] = None,
) -> ApiResponse[RawOcrData]:
    await _guard(limiter, account)
    result = await service.recognize(_collect(file, files))
    return ApiResponse(data=RawOcrData(**result), message="원시 OCR 결과를 불러왔습니다.")
