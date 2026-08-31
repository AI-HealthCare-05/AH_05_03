import asyncio
from google import genai
from google.genai import types

from app.core import config
from app.dtos.health_assistant import (
    HealthAssistantChatRequest,
    HealthAssistantResponse,
)
from app.exceptions import AppError


class HealthAssistantService:
    """통합 건강 어시스턴트 (봄이) 서비스.
    
    자연어 입력을 분석하여 건강기록(운동, 혈압, 혈당, 복약, 통증 등) 추출,
    기록 조회 의도 분류, 안전 가이드라인 기반 상담 응답을 생성합니다.
    """

    async def respond(self, request: HealthAssistantChatRequest) -> HealthAssistantResponse:
        api_key = config.GEMINI_API_KEY
        if not api_key:
            raise AppError("Gemini API 키가 설정되지 않았습니다.", status_code=503)

        client = genai.Client(api_key=api_key)

        context_info = ""
        if request.profile_context:
            ctx = request.profile_context
            details = []
            if ctx.profile_name:
                details.append(f"대상 프로필: {ctx.profile_name} ({ctx.relationship or '본인'})")
            if ctx.birth_year:
                details.append(f"출생년도: {ctx.birth_year}년")
            if ctx.recent_records_summary:
                details.append(f"최근 건강기록 요약: {ctx.recent_records_summary}")
            if details:
                context_info = "\n[현재 대화 대상 프로필 컨텍스트]\n" + "\n".join(details) + "\n"

        system_instruction = f"""당신은 가족 건강관리 서비스 '이어봄'의 친절하고 꼼꼼한 AI 건강 비서 '봄이'입니다.
사용자의 자연어 대화를 분석하여 구조화된 건강기록 초안을 작성하거나, 기록 조회/건강 질문에 답변합니다.

{context_info}
[핵심 원칙 및 안전 수칙 (매우 중요)]
1. 의료 진단/처방 절대 금지: 의학적 질병을 진단하거나, 약물을 처방하거나, "아무 문제 없습니다"와 같이 섣부른 안심을 제공하지 마세요.
2. 사실 기반 추출: 사용자가 명시적으로 언급한 내용만 초안(draft)에 추출하세요. 임의로 추측하거나 없는 값을 지어내지 마세요.
3. 확인 및 재질문:
   - 기록 입력 시 정보가 부족하거나 애매하면(예: 혈압에서 수축기/이완기 순서가 불분명하거나 하나만 말한 경우, 운동에서 무게나 횟수가 애매한 경우) `missing_fields`에 필드명을 넣고 사용자에게 친절하게 되물으세요.
   - 정보가 충분하여 저장할 준비가 되었을 때는 `needs_confirmation=true`로 설정하고 "오늘 기록에 이렇게 저장할까요?"라고 확인을 유도하세요.
4. 응급 상황 안내:
   - 사용자가 극심한 흉통, 호흡 곤란, 의식 저하, 마비, 심한 출혈 등 응급 증상을 호소하는 경우 `emergency_notice`에 119 또는 즉각적인 응급실 방문 안내 문구를 반드시 작성하세요.
5. 건강 질문 처리:
   - 복약/음주 등 건강 질문 시, 프로필 컨텍스트에 있는 최근 기록(예: 최근 복약 정보)을 바탕으로 주의사항을 안내하되, 단정적인 의료 판단을 하지 말고 약사 또는 의사 상담을 권고하세요.

[의도(intent)별 처리 지침]
- `record_exercise`: 운동 종목(exercise_name), 중량(weight_kg), 횟수(reps), 세트(sets) 추출. 날짜가 없으면 오늘로 간주.
- `record_blood_pressure`: 수축기(systolic), 이완기(diastolic), 맥박(pulse) 추출. 수축기는 보통 이완기보다 큽니다.
- `record_blood_glucose`: 혈당(glucose_mg_dl), 측정 시점(timing: fasting/before_meal/after_meal/bedtime/random) 추출.
- `record_medication`: 약품명(medication_name), 복용량(dosage), 복용시각(taken_at) 추출.
- `record_pain`: 통증 부위(body_area), 통증 강도(intensity: 0~10), 양상(sensation) 추출.
- `query_records`: 조회하려는 기록 종류(target_record_types)와 기간(period_description) 추출.
- `health_advice`: 개인 건강기록을 참고한 안전한 일반 건강정보 안내.
- `general_chat`: 친절한 일상 인사 및 사용법 안내.

반드시 지정된 JSON 스키마 형식으로 응답하세요."""

        contents = [
            f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}"
            for m in request.messages
        ]

        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    client.models.generate_content,
                    model="gemini-3.5-flash-lite",
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        response_schema=HealthAssistantResponse,
                        temperature=0.0,
                    ),
                ),
                timeout=12.0,
            )
        except asyncio.TimeoutError as ex:
            raise AppError("응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", status_code=504) from ex
        except Exception as ex:
            raise AppError("건강 어시스턴트 대화 처리 중 오류가 발생했습니다.", status_code=503) from ex

        if not response or not response.text:
            raise AppError("건강 어시스턴트 응답을 생성하지 못했습니다.", status_code=503)

        try:
            return HealthAssistantResponse.model_validate_json(response.text)
        except Exception as error:
            raise AppError("건강 대화 응답 구조화에 실패했습니다.", status_code=503) from error

