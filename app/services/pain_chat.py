import asyncio
import json

from google import genai
from google.genai import types

from app.core import config
from app.dtos.pain_chat import PainChatData, PainChatMessage
from app.exceptions import AppError


class PainChatService:
    async def respond(self, messages: list[PainChatMessage]) -> PainChatData:
        api_key = config.GEMINI_API_KEY
        if not api_key:
            raise AppError("Gemini API 키가 설정되지 않았습니다.", status_code=503)

        client = genai.Client(api_key=api_key)

        instructions = """You support a Korean health-recording form. Do not diagnose, prescribe, or reassure medically.
Extract only facts explicitly stated by the user into the draft.
Ask one concise Korean follow-up question for missing body_area or intensity.
missing_fields may only contain 'body_area' or 'intensity'.
If the user mentions severe chest pain, breathing difficulty, loss of consciousness, stroke-like symptoms, severe bleeding, or self-harm, set emergency_notice to a short Korean emergency-care instruction; still do not diagnose.
Return the structured JSON output."""

        contents = [
            f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}"
            for m in messages
        ]

        models_to_try = ["gemini-3.5-flash-lite", "gemini-3.5-flash"]
        last_err = None
        response = None

        for model_name in models_to_try:
            try:
                response = await asyncio.to_thread(
                    client.models.generate_content,
                    model=model_name,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=instructions,
                        response_mime_type="application/json",
                        response_schema=PainChatData,
                        temperature=0.0,
                    ),
                )
                if response and response.text:
                    break
            except Exception as ex:
                last_err = ex
                continue

        if not response or not response.text:
            if last_err:
                raise AppError("통증 대화 처리 중 오류가 발생했습니다.", status_code=503) from last_err
            raise AppError("통증 기록 응답을 생성하지 못했습니다.", status_code=503)

        try:
            return PainChatData.model_validate_json(response.text)
        except Exception as error:
            raise AppError("통증 대화 응답 데이터 구조화에 실패했습니다.", status_code=503) from error

