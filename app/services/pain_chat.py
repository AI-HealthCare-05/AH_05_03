import json

import httpx

from app.core import config
from app.dtos.pain_chat import PainChatData, PainChatMessage
from app.exceptions import AppError


class PainChatService:
    async def respond(self, messages: list[PainChatMessage]) -> PainChatData:
        if not config.OPENAI_KEY:
            raise AppError("OpenAI API 키가 설정되지 않았습니다.", status_code=503)
        schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["assistant_message", "draft", "missing_fields", "emergency_notice"],
            "properties": {
                "assistant_message": {"type": "string"},
                "draft": {"type": "object", "additionalProperties": False, "required": ["body_area", "intensity", "sensation", "onset_description", "aggravating_factors", "note"], "properties": {"body_area": {"type": ["string", "null"]}, "intensity": {"type": ["integer", "null"], "minimum": 0, "maximum": 10}, "sensation": {"type": ["string", "null"]}, "onset_description": {"type": ["string", "null"]}, "aggravating_factors": {"type": ["string", "null"]}, "note": {"type": ["string", "null"]}}},
                "missing_fields": {"type": "array", "items": {"type": "string"}},
                "emergency_notice": {"type": ["string", "null"]},
            },
        }
        instructions = """You support a Korean health-recording form. Do not diagnose, prescribe, or reassure medically. Extract only facts explicitly stated by the user into the draft. Ask one concise Korean follow-up question for missing body_area or intensity. missing_fields may only contain body_area or intensity. If the user mentions severe chest pain, breathing difficulty, loss of consciousness, stroke-like symptoms, severe bleeding, or self-harm, set emergency_notice to a short Korean emergency-care instruction; still do not diagnose. Return only the required JSON schema."""
        body = {"model": config.OPENAI_PAIN_CHAT_MODEL, "instructions": instructions, "input": [{"role": item.role, "content": item.content} for item in messages], "text": {"format": {"type": "json_schema", "name": "pain_chat", "strict": True, "schema": schema}}, "temperature": 0}
        try:
            async with httpx.AsyncClient(timeout=config.OPENAI_PAIN_CHAT_TIMEOUT_SECONDS) as client:
                response = await client.post("https://api.openai.com/v1/responses", headers={"Authorization": f"Bearer {config.OPENAI_KEY}"}, json=body)
            response.raise_for_status()
            payload = response.json()
            # output_text는 OpenAI Python SDK의 편의 속성이다. REST JSON에서는
            # message.content의 output_text 항목을 직접 찾아야 한다.
            text = next(
                (
                    content.get("text")
                    for output in payload.get("output", [])
                    for content in output.get("content", [])
                    if content.get("type") == "output_text" and content.get("text")
                ),
                None,
            )
            if not text:
                raise ValueError("empty OpenAI response")
            return PainChatData.model_validate(json.loads(text))
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            if status == 401:
                message = "OpenAI API 키를 확인해 주세요. 키를 바꿨다면 백엔드를 다시 시작해야 합니다."
            elif status == 404:
                message = "설정된 OpenAI 모델을 사용할 수 없습니다. OPENAI_PAIN_CHAT_MODEL 설정을 확인해 주세요."
            elif status == 429:
                message = "OpenAI 요청 한도 또는 결제 상태를 확인해 주세요."
            else:
                message = f"OpenAI 요청 설정 오류(HTTP {status})입니다. 모델 또는 API 프로젝트 설정을 확인해 주세요."
            raise AppError(message, status_code=503) from error
        except httpx.TimeoutException as error:
            raise AppError(
                "응답이 3초 안에 도착하지 않았습니다. 통증 부위와 정도를 직접 입력해 주세요.",
                status_code=503,
            ) from error
        except (httpx.HTTPError, ValueError, json.JSONDecodeError) as error:
            raise AppError("OpenAI 응답을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", status_code=503) from error
