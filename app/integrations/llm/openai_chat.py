"""OpenAI 대화 클라이언트 — Gemini 와 같은 계약(`LLMClientProtocol`)을 따른다.

왜 두 번째 공급자가 필요한가
----------------------------
Gemini 무료 등급의 할당량은 **모델마다 하루 단위로 따로** 센다
(`GenerateRequestsPerDayPerProjectPerModel-FreeTier`). 다 쓰면 그 모델은 그날 끝이고,
대화 화면은 아무 말도 못 하게 된다. 문서 인식 쪽은 이미 순서 목록으로 넘어가는데
(`app/services/dev_ocr.py`) 대화만 한 공급자에 매여 있었다.

**구조화 출력을 어떻게 받나**
`response_format={"type": "json_schema"}` 로 스키마를 걸면 모델이 그 모양을 벗어난
JSON 을 내지 못한다. Gemini 의 `response_schema` 와 같은 자리다. OpenAI 는
`additionalProperties: false` 와 **모든 속성의 `required` 명시**를 요구하므로
(`strict: true`), 그 변환을 `_strictify` 가 한다 — OCR 쪽(`ocr_providers._strictify`)과
같은 규칙이고, 스키마 모양이 달라 공유하지 않고 각자 둔다.
"""

from __future__ import annotations

import asyncio
from typing import Any, TypeVar, cast

from openai import AsyncOpenAI
from pydantic import BaseModel

from app.core import config
from app.dtos.health_assistant import ChatMessage
from app.exceptions import LlmProviderFailedError, LlmTimeoutError, LlmUnavailableError
from app.integrations.llm.protocol import LLMClientProtocol

T = TypeVar("T", bound=BaseModel)


def _strictify(schema: dict[str, Any]) -> dict[str, Any]:
    """OpenAI `strict` 스키마 규칙에 맞춘다.

    두 가지를 강제한다 — 객체마다 `additionalProperties: false`, 그리고 **모든 속성을
    `required` 에** 넣기. 선택 필드도 required 에 들어가야 하므로 `null` 을 허용하는
    쪽으로 타입을 넓힌다. 안 그러면 모델이 필드를 통째로 빼 버리고 검증에서 터진다.
    """
    if not isinstance(schema, dict):
        return schema
    node = {key: value for key, value in schema.items() if key not in {"default", "examples", "title"}}
    for key in ("properties", "$defs", "definitions"):
        if isinstance(node.get(key), dict):
            node[key] = {name: _strictify(value) for name, value in node[key].items()}
    for key in ("items", "additionalItems"):
        if isinstance(node.get(key), dict):
            node[key] = _strictify(node[key])
    for key in ("anyOf", "oneOf", "allOf"):
        if isinstance(node.get(key), list):
            node[key] = [_strictify(entry) for entry in node[key]]
    if node.get("type") == "object" or "properties" in node:
        node["additionalProperties"] = False
        node["required"] = sorted(node.get("properties", {}))
    return node


class OpenAIChatClient(LLMClientProtocol):
    """`openai:gpt-4o-mini` 같은 항목이 가리키는 공급자."""

    def __init__(
        self,
        api_key: str | None,
        model_name: str | None = None,
        temperature: float = 0.0,
        timeout: float | None = None,
    ) -> None:
        if not api_key:
            raise LlmUnavailableError("OpenAI API 키가 설정되지 않았습니다.")
        self.client = AsyncOpenAI(api_key=api_key)
        self.model_name = model_name or config.OPENAI_CHAT_MODEL
        self.temperature = temperature
        self.timeout = timeout if timeout is not None else config.LLM_CHAT_TIMEOUT_SECONDS

    async def generate_structured_response(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
    ) -> T:
        payload: list[dict[str, str]] = [{"role": "system", "content": system_instruction}]
        payload += [
            {"role": "assistant" if message.role == "assistant" else "user", "content": message.content}
            for message in messages
        ]

        try:
            completion = await asyncio.wait_for(
                self.client.chat.completions.create(
                    model=self.model_name,
                    # SDK 의 메시지·응답형식 타입이 좁은 리터럴 조합이라 그대로는 안
                    # 들어간다. `ocr_providers` 도 같은 이유로 `cast` 를 쓴다.
                    messages=cast(Any, payload),
                    temperature=self.temperature,
                    response_format=cast(
                        Any,
                        {
                            "type": "json_schema",
                            "json_schema": {
                                "name": response_schema.__name__,
                                "strict": True,
                                "schema": _strictify(response_schema.model_json_schema()),
                            },
                        },
                    ),
                ),
                timeout=self.timeout,
            )
        except TimeoutError as ex:
            raise LlmTimeoutError() from ex
        except Exception as ex:
            # 모델명 오류·인증 실패·레이트리밋이 여기 모인다. Gemini 쪽과 같은 이유로
            # 502 다 — 업스트림 사정을 우리 쪽 장애(503)로 덮으면 원인을 못 찾는다.
            raise LlmProviderFailedError(f"OpenAI 호출 실패: {type(ex).__name__}") from ex

        text = completion.choices[0].message.content if completion.choices else None
        if not text:
            raise LlmProviderFailedError("OpenAI 가 빈 응답을 돌려줬습니다.")

        try:
            return response_schema.model_validate_json(text)
        except Exception as ex:
            raise LlmProviderFailedError(f"응답 구조화 실패: {type(ex).__name__}") from ex
