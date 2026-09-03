import asyncio
import json
import re
from collections.abc import AsyncIterator, Awaitable, Callable

from fastapi import UploadFile

from app.core import config
from app.core.logger import setup_logger
from app.exceptions import (
    AppError,
    OcrFileTooLargeError,
    OcrNoFileError,
    OcrProviderFailedError,
    OcrUnavailableError,
    OcrUnsupportedTypeError,
)
from app.services import ocr_providers
from app.services.ocr_partial import PartialJsonTextReader

# **`logging.getLogger` 로는 부족하다.** 그러면 이 로거에 핸들러가 없어 레코드가 root
# 로 올라가는데, FastAPI(uvicorn) 도 워커도 root 를 설정하지 않아 INFO 가 통째로
# 사라진다. 실제로 "어느 모델이 답했는지" 를 남기고도 로그에 안 찍혀서 한 번 헛돌았다 —
# WARNING 만 파이썬 기본 lastResort 로 새어 나오고 있었다.
logger = setup_logger("app.dev_ocr")

_ALLOWED_CONTENT_TYPES = {
    "image/jpeg": "image/jpeg",
    "image/png": "image/png",
    "image/webp": "image/webp",
    "application/pdf": "application/pdf",
}


def _resolve_mime_type(upload: UploadFile) -> str | None:
    """선언된 content-type 을 먼저 보고, 없으면 확장자로 보조 판별한다."""
    declared = _ALLOWED_CONTENT_TYPES.get(upload.content_type or "")
    if declared is not None:
        return declared

    filename = (upload.filename or "").lower()
    for suffixes, mime in (
        ((".pdf",), "application/pdf"),
        ((".png",), "image/png"),
        ((".jpg", ".jpeg"), "image/jpeg"),
        ((".webp",), "image/webp"),
    ):
        if filename.endswith(suffixes):
            return mime
    return None


async def _to_part(upload: UploadFile) -> tuple[bytes, str]:
    """업로드 하나를 (본문, MIME) 으로 바꾼다. 크기·형식 검증이 여기 모여 있다.

    Gemini 파트가 아니라 바이트를 내는 이유는 큐 때문이다 — 생산자는 이 결과를
    Redis 에 실어야 하고, Gemini 파트로 만드는 것은 실제 호출 직전에 하면 된다.
    """
    mime_type = _resolve_mime_type(upload)
    if mime_type is None:
        raise OcrUnsupportedTypeError("현재 OCR은 JPEG, PNG, WEBP 이미지 및 PDF 문서만 지원합니다.")

    # 상한 + 1 만큼 읽어야 "정확히 상한" 과 "상한 초과" 를 가를 수 있다.
    content = await upload.read(config.DEV_OCR_MAX_FILE_BYTES + 1)
    if not content:
        raise OcrNoFileError("비어 있는 파일은 인식할 수 없습니다.")
    if len(content) > config.DEV_OCR_MAX_FILE_BYTES:
        raise OcrFileTooLargeError("OCR 파일은 각 20MB 이하여야 합니다.")
    return content, mime_type


_PROMPT = (
    "당신은 의료 문서 전문 OCR 및 데이터 구조화 AI입니다.\n"
    "제공된 건강검진 결과지, 검사결과서, 진단서, 처방전 문서(다중 페이지 PDF 또는 여러 장의 이미지 포함)를 종합 분석하여 "
    "사용자가 보기 쉽고 명확하게 정형화된 JSON 데이터로 변환하세요.\n\n"
    "지침:\n"
    "1. tables (검사 항목 표 추출):\n"
    "   - 여러 페이지나 여러 장의 사진에 나뉘어 있는 모든 검사 항목(요검사, 혈액검사, 간기능, 혈당, 지질/콜레스테롤, 신장기능, 혈압 등)을 빠짐없이 하나의 통합 표로 구조화하세요.\n"
    "   - 각 행(row)의 배열은 반드시 다음 순서의 4개 열로 구성하세요: [검사항목명, 결과값, 단위, 판정및참고치]\n"
    "     예시: ['식전혈당(FBS)', '113', 'mg/dL', '이상 (정상: 74~99)'], ['AST (SGOT)', '41', 'U/L', '이상 (정상: 0~40)'], ['수축기 혈압', '120', 'mmHg', '정상']\n"
    "   - 단위나 판정이 문서에 없으면 빈 문자열('')로 채우세요.\n"
    "   - **전사 원칙(가장 중요):** 문서에 인쇄된 글자를 그대로 옮기세요. 위 예시는 열의 순서를 보여줄 뿐이며 "
    "검사명을 그 예시처럼 표준명이나 영문 약어로 바꾸라는 뜻이 아닙니다.\n"
    "     · 검사명은 문서에 적힌 표기 그대로 씁니다. 비슷한 다른 검사명으로 바꾸지 마세요 "
    "(예: '요소질소'를 '요단백'이나 '요산'으로, '크레아티닌'을 '크레아틴'으로 바꾸면 완전히 다른 검사가 됩니다).\n"
    "     · 참고치는 문서에 인쇄된 숫자만 옮깁니다. 일반적으로 알려진 정상범위를 기억해서 채워 넣지 마세요.\n"
    "     · 글자가 흐리거나 잘려 확실하지 않으면 추측하지 말고 빈 문자열('')로 두세요. "
    "비어 있는 편이 잘못된 값보다 안전합니다.\n"
    "     · 같은 검사명이 두 행에 나왔다면 하나는 잘못 읽은 것입니다. 다시 확인하세요.\n"
    "2. text (전체 텍스트 정리):\n"
    "   - 문서의 기본 정보(환자 정보, 검사일자, 병원/기관명)와 검사 결과들을 줄바꿈(\\n)을 적절히 사용하여 깔끔하고 가독성 높게 작성하세요.\n"
    "   - 문장이 이어져서 한 덩어리의 줄글로 뭉치지 않도록 항목별로 줄바꿈을 반드시 적용하세요."
)


# 시도 순서는 `config.DEV_OCR_MODELS` 가 정한다 — 모델 가용성이 날마다 달라서
# 코드를 고쳐 배포하는 대신 `.env` 한 줄로 뒤집을 수 있어야 한다. 실측 근거는
# `app/core/config.py` 의 `DEV_OCR_MODELS` 주석에 있다.
#
# **앞선 기록의 오진을 바로잡는다.** `docs/40` 은 `gemini-3.7-flash` 가 "응답하지
# 않는다(40초 타임아웃)" 고 적었는데, 45초 래퍼를 걷고 재 보니 타임아웃이 아니라
# **503 용량 부족**이었다. 게다가 SDK 재시도를 꺼도(`attempts=1`) 102초·1200초를 쓰고
# 나서야 503 이 돌아온다 — 서버가 연결을 붙잡는 것이라 끊는 쪽은 우리여야 한다.
# 그래서 `_stream_once` 의 `asyncio.wait_for` 가 실제 방어선이다.
_MODELS = tuple(config.DEV_OCR_MODELS)


class _StreamEvent(dict):
    """`stream_parts` 가 내보내는 이벤트. `kind` 로 갈린다.

    - `delta`  — `text` 에 새로 해독된 사람이 읽을 문자열
    - `reset`  — 앞 모델이 도중에 실패해 다른 모델로 다시 시작한다. 지금까지 보여 준
                 것을 지우라는 뜻이다
    - `result` — `data` 에 완성된 인식 결과
    """


async def _stream_once(
    entry: str,
    files: list[tuple[bytes, str]],
) -> AsyncIterator[tuple[str, str]]:
    """목록 항목 하나를 스트리밍으로 부른다. `(원본 JSON 조각, 해독된 텍스트 델타)`.

    **공급자를 모른다.** `ocr_providers.build` 가 Gemini·OpenAI 중 맞는 것을 골라 주고,
    여기서는 조각을 받아 타임아웃을 재고 사람이 읽을 글로 바꾸는 일만 한다.

    **두 겹의 타임아웃을 쓴다.** 예전에는 호출 전체에 45초 하나만 걸었는데, 그러면
    응답이 오는 중인 긴 문서도 45초에 잘리고 반대로 아주 느리게 흘리는 응답은 못 끊는다.
    첫 청크까지(모델이 응답하는가)와 청크 사이(진행 중인가)를 갈라 잰다.
    """
    reader = PartialJsonTextReader()
    provider = ocr_providers.build(entry)
    iterator = provider.stream(files, _PROMPT).__aiter__()
    timeout = config.DEV_OCR_FIRST_CHUNK_TIMEOUT_SECONDS
    deadline = asyncio.get_running_loop().time() + config.DEV_OCR_CALL_TIMEOUT_SECONDS
    while True:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise TimeoutError(f"{entry} 응답이 전체 상한을 넘었다")
        try:
            piece = await asyncio.wait_for(iterator.__anext__(), timeout=min(timeout, remaining))
        except StopAsyncIteration:
            return
        # 첫 청크를 받은 뒤로는 "진행 중인가" 만 본다.
        timeout = config.DEV_OCR_CHUNK_IDLE_TIMEOUT_SECONDS
        if not piece:
            continue
        yield piece, reader.push(piece)


async def _try_model(
    entry: str,
    files: list[tuple[bytes, str]],
    attempt: int,
) -> AsyncIterator[_StreamEvent]:
    """목록 항목 하나로 끝까지 간다. 마지막에 `result` 이벤트를 낸다.

    실패는 **예외로만** 알린다 — 호출부가 `except` 한 곳에서 다음 항목으로 넘기면 되도록.
    """
    raw = ""
    started = asyncio.get_running_loop().time()
    async for piece, decoded in _stream_once(entry, files):
        raw += piece
        if decoded:
            yield _StreamEvent(kind="delta", text=decoded)

    if not raw:
        raise OcrProviderFailedError(f"{entry} 이 빈 응답을 돌려줬습니다.")
    result = json.loads(raw)  # ValueError 는 호출부가 다음 항목으로 넘긴다

    # **어느 공급자의 어느 모델이 답했는지 남긴다.** 예전에는 이 정보가 어디에도 없어서
    # "지금 무슨 모델을 쓰고 있나" 를 코드만 보고는 알 수 없었다. 공급자가 둘이 된
    # 지금은 **비용이 걸린 정보**이기도 하다 — OpenAI 로 넘어갔다는 것은 과금됐다는 뜻이다.
    logger.info(
        "OCR 성공 · model=%s attempt=%d %.1fs 표=%d",
        entry,
        attempt + 1,
        asyncio.get_running_loop().time() - started,
        len(result.get("tables") or []),
    )
    yield _StreamEvent(kind="result", data=_finalize(result))


async def stream_parts(files: list[tuple[bytes, str]]) -> AsyncIterator[_StreamEvent]:
    """인식을 스트리밍으로 수행한다. **동기 경로도 이 함수를 쓴다.**

    `recognize_parts` 는 이 생성기를 끝까지 돌려 마지막 `result` 만 돌려주는 얇은
    껍데기다. 두 벌로 두면 같은 문서에 다른 결과가 나올 수 있고, 그건 사용자가 두 번
    올렸을 때 설명할 수 없는 동작이 된다.
    """
    _require_bridge(files)

    last_err: Exception | None = None
    for attempt, model_name in enumerate(_MODELS):
        retried_after_429 = False
        while True:
            emitted = False
            try:
                async for event in _try_model(model_name, files, attempt):
                    emitted = emitted or event.get("kind") == "delta"
                    yield event
                    if event.get("kind") == "result":
                        return
            except Exception as error:  # noqa: BLE001 - 어떤 실패든 다음 모델로 넘긴다
                last_err = error

                # **429 는 "안 된다" 가 아니라 "이따 다시 오라" 다.** 응답이 대기 시간을
                # 알려 주므로 짧으면 지킨다. 이걸 무시하고 모델 둘을 1.5초 만에 연달아
                # 태우면 둘 다 같은 429 를 맞고 작업이 실패로 확정된다 — 실제로 그랬다.
                wait = _retry_after_seconds(error)
                if wait is not None and not emitted and not retried_after_429:
                    retried_after_429 = True
                    logger.info("OCR 429 · model=%s %.0f초 뒤 같은 모델로 재시도", model_name, wait)
                    await asyncio.sleep(wait)
                    continue

                # **본문이나 오류 상세를 남기지 않는다.** 남기는 것은 모델명과 예외 종류뿐이다.
                logger.warning(
                    "OCR 모델 실패 · model=%s attempt=%d %s",
                    model_name,
                    attempt + 1,
                    type(error).__name__,
                )
                if emitted:
                    # 이미 화면에 글자를 뿌린 뒤다. 다음 모델의 출력이 그 뒤에 이어
                    # 붙으면 앞뒤가 섞인 글이 되므로 지우라고 알린다.
                    yield _StreamEvent(kind="reset")
            break

    if isinstance(last_err, AppError):
        raise last_err
    if last_err:
        raise OcrProviderFailedError("문서 구조화에 실패했습니다. (외부 전송 오류 포함)") from last_err
    raise OcrProviderFailedError("문서 인식 공급자로부터 응답을 받지 못했습니다.")


#: 429 본문의 "Please retry in 19.925417153s". SDK 가 구조화된 필드로 안 주고
#: 문자열로 던지므로 여기서 뽑는다.
_RETRY_AFTER = re.compile(r"retry in ([0-9.]+)s")


def _retry_after_seconds(error: BaseException) -> float | None:
    """429 가 알려 준 대기 시간. 지킬 만큼 짧을 때만 돌려준다.

    진짜 하루치 소진이면 이 값이 수천 초라 상한에 걸려 `None` 이 되고, 호출부는
    기다리지 않고 곧장 다음 모델로 넘어간다.
    """
    text = str(error)
    if "RESOURCE_EXHAUSTED" not in text:
        return None
    found = _RETRY_AFTER.search(text)
    if found is None:
        return None
    wait = float(found.group(1))
    return wait if wait <= config.DEV_OCR_RETRY_AFTER_MAX_SECONDS else None


def _require_bridge(files: list[tuple[bytes, str]]) -> None:
    if not config.ENABLE_DEV_OCR_BRIDGE:
        raise OcrUnavailableError("개발용 OCR 브리지가 비활성화되어 있습니다.")
    if not files:
        raise OcrNoFileError("인식할 파일이 제공되지 않았습니다.")
    if not config.GEMINI_API_KEY:
        raise OcrUnavailableError("Gemini API 키가 설정되지 않았습니다.")


def _finalize(result: dict) -> dict:
    """API 계약(Contract) 충족을 위한 기본값 고정."""
    result["status"] = "raw"
    result["automatically_confirmed"] = False
    return result


async def recognize_parts(
    files: list[tuple[bytes, str]],
    on_event: Callable[[_StreamEvent], Awaitable[None]] | None = None,
) -> dict:
    """이미 읽어 둔 (본문, MIME) 목록을 인식한다. **워커가 부르는 진입점이다.**

    `DevOcrService.recognize` 는 `UploadFile` 을 받아 검증하고 이 함수를 부른다.
    워커에는 `UploadFile` 이 없고 Redis 에서 꺼낸 바이트만 있으므로 갈라 뒀다.
    채점 로직을 두 벌로 두면 동기·비동기 결과가 갈리므로 본문은 여기 하나뿐이다.

    `on_event` 를 주면 진행 중 이벤트를 그대로 넘겨준다. 워커가 이걸로 부분 결과를
    Redis 에 흘리고, FastAPI 가 그걸 SSE 로 중계한다. **주지 않으면 동작이 예전과
    같다** — 동기 경로는 이 인자를 쓰지 않는다.
    """
    result: dict | None = None
    async for event in stream_parts(files):
        if on_event is not None:
            await on_event(event)
        if event.get("kind") == "result":
            result = event["data"]
    if result is None:
        # `stream_parts` 는 실패하면 예외를 던진다. 여기에 온다는 것은 결과 이벤트
        # 없이 정상 종료했다는 뜻이라 방어적으로만 둔다.
        raise OcrProviderFailedError("문서 인식 공급자로부터 응답을 받지 못했습니다.")
    return result


async def read_uploads(uploads: list[UploadFile]) -> list[tuple[bytes, str]]:
    """업로드를 검증하며 (본문, MIME) 목록으로 바꾼다. 큐 생산자도 이걸 쓴다."""
    try:
        collected: list[tuple[bytes, str]] = []
        for upload in uploads:
            part = await _to_part(upload)
            collected.append(part)
        return collected
    finally:
        for upload in uploads:
            await upload.close()


class DevOcrService:
    """Gemini API를 이용한 비식별 문서 구조화 프록시 서비스.

    디스크(DB, File System)나 로그에 원본 이미지나 결과를 남기지 않고 메모리 상에서 처리한다.
    추후 브라우저 로컬 모델로 교체 시 이 서비스는 제거된다.
    """

    async def recognize(self, uploads: list[UploadFile] | UploadFile) -> dict:
        """동기 경로. 검증하고 곧바로 인식한다.

        비동기 경로(`POST /dev/ocr/jobs`)와 **같은 `recognize_parts` 를 부른다.**
        두 벌로 두면 같은 문서에 다른 결과가 나올 수 있고, 그건 사용자가 두 번
        올렸을 때 설명할 수 없는 동작이 된다.
        """
        if not config.ENABLE_DEV_OCR_BRIDGE:
            raise OcrUnavailableError("개발용 OCR 브리지가 비활성화되어 있습니다.")
        file_list = uploads if isinstance(uploads, list) else [uploads]
        if not file_list:
            raise OcrNoFileError("인식할 파일이 제공되지 않았습니다.")
        return await recognize_parts(await read_uploads(file_list))
