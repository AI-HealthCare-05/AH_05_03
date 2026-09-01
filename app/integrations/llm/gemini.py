import asyncio
from typing import TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.dtos.health_assistant import ChatMessage
from app.exceptions import AppError
from app.integrations.llm.protocol import LLMClientProtocol

T = TypeVar("T", bound=BaseModel)


class GeminiLLMClient(LLMClientProtocol):
    def __init__(
        self,
        api_key: str | None,
        model_name: str = "gemini-3.5-flash-lite",
        temperature: float = 0.0,
        timeout: float = 12.0,
    ):
        if not api_key:
            raise AppError("Gemini API 키가 설정되지 않았습니다.", status_code=503)
        self.client = genai.Client(api_key=api_key)
        self.model_name = model_name
        self.temperature = temperature
        self.timeout = timeout

    async def generate_structured_response(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
    ) -> T:
        gemini_contents = []
        for m in messages:
            role = "user" if m.role == "user" else "model"
            gemini_contents.append(
                types.Content(
                    role=role,
                    parts=[types.Part.from_text(text=m.content)],
                )
            )

        try:
            response = await asyncio.wait_for(
                self.client.aio.models.generate_content(
                    model=self.model_name,
                    contents=gemini_contents,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        response_schema=response_schema,
                        temperature=self.temperature,
                    ),
                ),
                timeout=self.timeout,
            )
        except asyncio.TimeoutError as ex:
            raise AppError("응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", status_code=504) from ex
        except Exception as ex:
            raise AppError("건강 어시스턴트 대화 처리 중 오류가 발생했습니다.", status_code=503) from ex

        if not response or not response.text:
            raise AppError("건강 어시스턴트 응답을 생성하지 못했습니다.", status_code=503)

        try:
            return response_schema.model_validate_json(response.text)
        except Exception as error:
            raise AppError("건강 대화 응답 구조화에 실패했습니다.", status_code=503) from error
