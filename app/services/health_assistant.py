import asyncio
from datetime import datetime
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

        now = datetime.now()
        today_str = now.strftime("%Y-%m-%d")
        current_year = now.year
        last_year = current_year - 1
        two_years_ago = current_year - 2

        context_info = f"[현재 시스템 기준 일자: {today_str} (올해: {current_year}년, 작년: {last_year}년, 재작년: {two_years_ago}년)]\n"
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
                context_info += "[현재 대화 대상 프로필 컨텍스트]\n" + "\n".join(details) + "\n"

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
5. 최근 건강기록(복약, 혈압 등) 컨텍스트 적극 반영:
   - 프로필 컨텍스트에 '최근 건강기록 요약'이 주어지면, 사용자의 건강 질문(음주, 운동, 식사 등) 및 기록 조회에 이를 적극적으로 연결하여 답변하세요.
   - 특히 음주 관련 질문 시 복약 기록(타이레놀, 소염진통제, 혈압약, 항생제 등)이 있다면, 해당 약품명을 직접 언급하며 알코올 상호작용 위험(예: 타이레놀/아세트아미노펜은 간 손상 위험 증가, 소염진통제는 위장 출혈 위험 등)을 알리고 음주를 피하도록 명확한 주의사항을 안내하세요.
   - 사용자가 기록 조회를 요청하거나 조회 칩을 누른 경우에도, 컨텍스트에 있는 해당 기록을 바탕으로 "최근 등록된 [기록 내용]이 있습니다."라고 알려주고 직전 대화 맥락(음주 여부 등)과 연결하여 종합적으로 답변하세요.
6. 이모티콘 금지:
   - 응답 텍스트(assistant_message, emergency_notice 등)에 이모티콘이나 이모지, 특수 기호 등을 절대 사용하지 마세요. 군더더기 없고 정갈하며 전문적인 한국어 평문으로만 작성하세요.

[의도(intent)별 처리 지침]
- `record_exercise`: 운동 종목(exercise_name), 중량(weight_kg), 횟수(reps), 세트(sets), 운동 시간(duration_minutes, 예: "30분 동안" -> 30, "1시간" -> 60), 수행 일시(date_str: 사용자가 "어제 저녁 9시", "오늘 오전 7시" 등을 말하면 해당 일자와 시각을 반영한 YYYY-MM-DDTHH:MM 형식) 추출.
- `record_blood_pressure`: 수축기(systolic), 이완기(diastolic), 맥박(pulse), 측정 일시(measured_at: YYYY-MM-DDTHH:MM 형식, 언급된 시각 반영) 추출. 수축기는 보통 이완기보다 큽니다.
- `record_blood_glucose`: 혈당(glucose_mg_dl), 측정 시점(timing: fasting/before_meal/after_meal/bedtime/random), 측정 일시(measured_at: YYYY-MM-DDTHH:MM 형식) 추출.
- `record_medication`: 약품명(medication_name), 복용량(dosage), 복용시각(taken_at: YYYY-MM-DDTHH:MM 형식 또는 시간대) 추출.
- `record_pain`: 통증 부위(body_area), 통증 강도(intensity: 0~10), 양상(sensation), 발생/기록 시각(onset_at: YYYY-MM-DDTHH:MM 형식) 추출.
- `record_lab_result`: 건강검진 또는 검사 서류(혈액검사, 건강검진표 등)의 OCR 내용에서 서류에 기재된 **실제 검사일자/수검일자**(예: 2022.05.30, 2025.08.28 등)를 반드시 찾아 `recorded_at` (YYYY-MM-DD 형식)으로 추출하세요. (오늘 업로드한 날짜가 아니라 서류에 적힌 실제 검진일자여야 합니다). 검진명(screening_name), 검사기관(institution), 핵심요약(summary), 주요 검사항목 및 수치(items_summary)를 추출하세요.
- `query_records`: 조회하려는 기록 종류(record_type)와 기간(time_range), 검색 키워드(keyword) 추출.
  * 수치 변화/그래프 요청 처리: 사용자가 "수치 변화", "그래프", "추이", "트렌드", "혈압 변화", "간수치 변화", "혈당 그래프" 등을 요청하면 `record_type: "trend"`, `time_range: "all"`, `keyword: "trend"`로 추출하고, "등록된 건강검진 및 측정 기록의 시계열 수치 변화 그래프를 조회해 드립니다. 아래 차트에서 혈압, 혈당, 간기능, 콜레스테롤 등의 변화 추이를 확인해 보세요."라고 안내하세요.
  * 기간(time_range) 추출 규칙:
    - "작년", "작년 검진": "{last_year}"
    - "올해": "{current_year}"
    - "재작년": "{two_years_ago}"
    - 특정 연도 언급(예: "2022년", "2024년"): "2022", "2024" 등 해당 4자리 연도
    - 특정 날짜 언급(예: "8월 28일", "5월 30일"): "08-28" 또는 "05-30" 또는 "YYYY-MM-DD"
    - 오늘: "today", 전체/모든 서류: "all"
  * 사실 기반 일치 여부 안내: 사용자가 특정 기간(예: 작년={last_year}년)의 기록을 물었는데 컨텍스트에 해당 연도 기록이 없고 다른 연도(예: 2022년 등) 기록만 있다면, 다른 연도 기록을 '작년'이라고 속이지 마세요. "작년({last_year}년)에 등록된 검진 기록은 없으며, 가장 최근에 등록된 검진은 [실제 검진 연도 및 일자] [검진명]입니다."와 같이 사실대로 명확히 안내하세요.
  * 중요: 원본 서류 조회를 요청할 때에는 이전 수치 텍스트를 장황하게 전부 나열하지 마세요. (실제 원본 이미지 카드들은 시스템이 화면에 인라인으로 표시합니다).
- `health_advice`: 개인 건강기록(복약, 혈압 등)을 연계한 안전하고 구체적인 일반 건강정보 및 주의사항 안내.
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

