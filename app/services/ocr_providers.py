"""문서 인식 공급자 어댑터. 각 공급자를 **같은 모양**으로 감싼다.

    async for piece in provider.stream(files, prompt):   # 원본 JSON 조각
        ...

## 왜 조각이 JSON 인가

두 공급자 모두 `OcrDocumentContent` 스키마를 강제해 부른다. 그래서 흘러나오는 것은 문장이
아니라 JSON 문서의 조각이고, 사람이 읽을 글로 바꾸는 일은 `ocr_partial.py` 가 맡는다.
**그 파서는 공급자를 모른다** — JSON 조각만 보므로 공급자를 늘려도 손댈 것이 없다.

## 공급자를 나눈 기준

지연·재시도·타임아웃·`reset` 이벤트는 전부 `dev_ocr.py` 가 공급자와 무관하게 처리한다.
여기 있는 것은 **"바이트와 프롬프트를 주면 JSON 조각을 흘린다"** 뿐이다. 그 경계를
지켜야 공급자를 하나 더 붙일 때 고칠 곳이 이 파일 하나로 끝난다.
"""

from __future__ import annotations

import base64
from collections.abc import AsyncIterator, Sequence
from typing import Any, Protocol, cast

from app.core import config
from app.dtos.ocr import OcrDocumentContent
from app.exceptions import OcrUnavailableError, OcrUnsupportedTypeError

#: 접두사가 없는 항목은 Gemini 다. 기존 표기(`gemini-3.5-flash`)를 그대로 받기 위한 것이다.
DEFAULT_PROVIDER = "gemini"


def parse_entry(entry: str) -> tuple[str, str]:
    """`"openai:gpt-4o-mini"` → `("openai", "gpt-4o-mini")`.

    접두사가 없으면 `("gemini", entry)`. 모델명에 콜론이 들어가는 공급자는 아직 없다.
    """
    provider, _, model = entry.partition(":")
    if not model:
        return DEFAULT_PROVIDER, provider
    return provider, model


class OcrProvider(Protocol):
    # **`async def` 로 적으면 안 된다.** 그러면 "AsyncIterator 를 돌려주는 코루틴" 이 되어
    # 구현(비동기 제너레이터)과 타입이 안 맞는다. 제너레이터는 호출 즉시 이터레이터를
    # 돌려주므로 `def` 가 맞다.
    def stream(self, files: list[tuple[bytes, str]], prompt: str) -> AsyncIterator[str]: ...


class GeminiProvider:
    """`google-genai` 로 부른다. 이미지와 **PDF 를 인라인으로 함께** 받는다."""

    def __init__(self, model: str) -> None:
        self.model = model

    async def stream(self, files: list[tuple[bytes, str]], prompt: str) -> AsyncIterator[str]:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=config.GEMINI_API_KEY)
        parts = [types.Part.from_bytes(data=content, mime_type=mime) for content, mime in files]
        # 파트와 프롬프트를 그냥 펼치면 `list[object]` 로 추론된다. SDK 가 내보내는
        # `PartUnionDict` 를 그대로 써야 시그니처에 들어간다.
        contents: list[types.PartUnionDict] = [*parts, prompt]
        stream = await client.aio.models.generate_content_stream(
            model=self.model,
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=OcrDocumentContent,
                temperature=0.0,
                http_options=types.HttpOptions(
                    retry_options=types.HttpRetryOptions(attempts=config.DEV_OCR_SDK_RETRY_ATTEMPTS),
                    # HttpOptions.timeout 은 밀리초다 (SDK 가 내부에서 /1000 해 httpx 로 넘긴다).
                    timeout=int(config.DEV_OCR_CALL_TIMEOUT_SECONDS * 1000),
                ),
            ),
        )
        async for chunk in stream:
            piece = getattr(chunk, "text", None)
            if piece:
                yield piece


#: PDF 파트에 붙일 파일명. OpenAI 는 `filename` 을 요구하는데 우리는 원본 파일명을
#: 워커까지 들고 오지 않는다(로그·큐에 파일명을 남기지 않는 규칙 때문이다).
#: 확장자만 맞으면 되므로 고정값을 쓴다.
_PDF_FILENAME = "document.pdf"


class OpenAIProvider:
    """`openai` SDK 로 부른다. 이미지와 **PDF 를 함께** 받는다.

    이미지는 base64 data URL(`image_url` 파트), PDF 는 `file` 파트로 보낸다.
    PDF 는 예전에 "Files API 가 따로 필요하다" 며 Gemini 로 넘겼는데, Chat Completions
    가 base64 PDF 를 직접 받는다 — gpt-4o 계열은 거기서 텍스트와 페이지 이미지를
    함께 뽑는다. Gemini 를 목록에서 뺀 이상 이쪽이 PDF 를 받아야 한다.
    """

    def __init__(self, model: str) -> None:
        self.model = model

    async def stream(self, files: list[tuple[bytes, str]], prompt: str) -> AsyncIterator[str]:
        from openai import AsyncOpenAI

        unsupported = sorted({mime for _, mime in files if mime not in config.OPENAI_SUPPORTED_MIME_TYPES})
        if unsupported:
            # 다음 공급자로 넘기려는 것이므로 예외로 알린다. `dev_ocr` 이 잡아
            # 목록의 다음 항목을 시도한다.
            raise OcrUnsupportedTypeError(f"OpenAI 경로는 {', '.join(unsupported)} 을 지원하지 않습니다.")

        client = AsyncOpenAI(api_key=config.OPENAI_API_KEY, timeout=config.DEV_OCR_CALL_TIMEOUT_SECONDS)
        content: list[dict] = [{"type": "text", "text": prompt}]
        content += [_part(data, mime) for data, mime in files]

        # **Gemini 와 같은 스키마를 강제한다.** 그래야 두 경로의 결과가 같은 모양이고,
        # `ocr_partial.PartialJsonTextReader` 가 공급자를 몰라도 된다.
        # `additionalProperties: false` 와 전체 required 는 strict 모드의 요구사항이다.
        schema = OcrDocumentContent.model_json_schema()
        # SDK 의 `messages` 는 TypedDict 합집합이라 손으로 만든 dict 가 그대로는 안 들어간다.
        # 모양은 문서대로 맞췄으므로 여기서만 좁혀 준다.
        stream = await client.chat.completions.create(
            model=self.model,
            messages=cast(Any, [{"role": "user", "content": content}]),
            response_format=cast(
                Any,
                {
                    "type": "json_schema",
                    "json_schema": {"name": "raw_ocr_data", "schema": _strictify(schema), "strict": True},
                },
            ),
            temperature=0.0,
            stream=True,
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            piece = chunk.choices[0].delta.content
            if piece:
                yield piece


def _part(data: bytes, mime: str) -> dict:
    """파일 하나를 Chat Completions 콘텐츠 파트로 만든다.

    PDF 와 이미지가 파트 모양이 다르다. 둘 다 base64 data URL 을 싣지만 PDF 는
    `file` 이고 `filename` 이 필요하다 — 확장자로 형식을 판단하므로 빠뜨리면 400 이다.
    """
    encoded = base64.b64encode(data).decode()
    if mime == "application/pdf":
        return {
            "type": "file",
            "file": {"filename": _PDF_FILENAME, "file_data": f"data:{mime};base64,{encoded}"},
        }
    # `detail` 을 빼면 기본 `auto` 라 이미지를 줄여서 본다 — 검진표의 작은 한글이
    # 뭉개지고 모델이 검사명을 지어낸다. 근거와 실측은 `config.OPENAI_IMAGE_DETAIL` 참조.
    return {
        "type": "image_url",
        "image_url": {"url": f"data:{mime};base64,{encoded}", "detail": config.OPENAI_IMAGE_DETAIL},
    }


def _strictify(schema: dict) -> dict:
    """pydantic 스키마를 OpenAI strict 모드가 받는 모양으로 다듬는다.

    strict 모드는 **모든 객체에** `additionalProperties: false` 와 "속성 전부가
    required" 를 요구한다. pydantic 은 선택 필드를 required 에서 빼므로 그대로 보내면
    400 이 난다. 값 자체를 바꾸지는 않는다 — 모델이 채워야 할 칸이 늘 뿐이다.
    """
    if not isinstance(schema, dict):
        return schema
    out: dict[str, Any] = {key: _strictify(value) for key, value in schema.items()}
    if isinstance(out.get("properties"), dict):
        out["additionalProperties"] = False
        out["required"] = list(out["properties"].keys())
    for key in ("$defs", "properties"):
        if isinstance(schema.get(key), dict):
            out[key] = {name: _strictify(value) for name, value in schema[key].items()}
    if isinstance(schema.get("items"), dict):
        out["items"] = _strictify(schema["items"])
    return out


def require_any(entries: Sequence[str]) -> None:
    """목록에 **쓸 수 있는 항목이 하나라도** 있는지 본다. 없으면 이유를 모아 올린다.

    예전에는 호출부(`dev_ocr._require_bridge`)가 `GEMINI_API_KEY` 를 무조건 요구했다.
    그래서 목록을 `["openai:gpt-4o-mini"]` 로 바꿔도 **Gemini 키가 없으면 인식이 죽었다** —
    쓰지도 않는 공급자의 키가 없다고 막는 셈이었고, 공급자를 갈아 끼울 수 있게 만든
    구조를 그 한 줄이 되돌리고 있었다.

    판정은 `build` 하나에 맡긴다. 키·허용 목록·임베딩 모델 검사가 전부 거기 있으므로
    같은 규칙을 두 벌로 적지 않는다.
    """
    reasons: list[str] = []
    for entry in entries:
        try:
            build(entry)
        except OcrUnavailableError as unusable:
            reasons.append(f"{entry}: {unusable.message}")
            continue
        return
    detail = " / ".join(reasons) if reasons else "인식 모델 목록이 비어 있습니다."
    raise OcrUnavailableError(f"쓸 수 있는 문서 인식 공급자가 없습니다. ({detail})")


def build(entry: str) -> OcrProvider:
    """목록 항목 하나를 공급자로 만든다. 쓸 수 없으면 `OcrUnavailableError`.

    **키가 없으면 여기서 걸러진다.** 호출부가 잡아 다음 항목으로 넘어가므로,
    `openai:` 항목을 목록에 둔 채 키를 안 채워도 경로가 죽지 않는다.
    """
    provider, model = parse_entry(entry)
    if provider == "gemini":
        if not config.GEMINI_API_KEY:
            raise OcrUnavailableError("Gemini API 키가 설정되지 않았습니다.")
        return GeminiProvider(model)
    if provider == "openai":
        if not config.OPENAI_API_KEY:
            raise OcrUnavailableError("OpenAI API 키가 설정되지 않았습니다.")
        if model not in config.OPENAI_ALLOWED_MODELS:
            raise OcrUnavailableError(f"허용하지 않은 OpenAI 모델입니다: {model}")
        if model in config.OPENAI_EMBEDDING_MODELS:
            raise OcrUnavailableError(f"{model} 은 임베딩 모델이라 문서 인식에 쓸 수 없습니다.")
        return OpenAIProvider(model)
    raise OcrUnavailableError(f"알 수 없는 OCR 공급자입니다: {provider}")
