import asyncio
from datetime import datetime, timedelta, timezone
import json
import re

from google import genai
from google.genai import types

from app.core import config
from app.dtos.pain_chat import PainChatData, PainChatMessage
from app.exceptions import AppError

WEEKDAYS = {
    "월": 0, "월요일": 0,
    "화": 1, "화요일": 1,
    "수": 2, "수요일": 2,
    "목": 3, "목요일": 3,
    "금": 4, "금요일": 4,
    "토": 5, "토요일": 5,
    "일": 6, "일요일": 6,
}


def parse_korean_onset(text: str, ref_date: datetime) -> tuple[str | None, str | None, str | None]:
    ref_ymd = ref_date.date()
    today_weekday = ref_date.weekday()  # 0 = Monday, 6 = Sunday

    # 1. 저번주 / 지난주 / 지난 / 저번 + 요일
    match = re.search(r"(저번주|지난주|지난|저번)\s*(월요일|화요일|수요일|목요일|금요일|토요일|일요일|월|화|수|목|금|토|일)", text)
    if match:
        prefix = match.group(1)
        w_str = match.group(2)
        target_wd = WEEKDAYS[w_str]
        target_date = ref_ymd - timedelta(days=today_weekday + 7 - target_wd)
        desc = f"{prefix} {w_str}"
        return target_date.strftime("%Y-%m-%d"), desc, f"{target_date.month}월 {target_date.day}일 ({desc})"

    # 2. 이번주 / 이번 + 요일
    match = re.search(r"(이번주|이번)\s*(월요일|화요일|수요일|목요일|금요일|토요일|일요일|월|화|수|목|금|토|일)", text)
    if match:
        prefix = match.group(1)
        w_str = match.group(2)
        target_wd = WEEKDAYS[w_str]
        target_date = ref_ymd - timedelta(days=today_weekday - target_wd)
        desc = f"{prefix} {w_str}"
        return target_date.strftime("%Y-%m-%d"), desc, f"{target_date.month}월 {target_date.day}일 ({desc})"

    # 3. 그저께 / 그제
    if "그저께" in text or "그제" in text:
        target_date = ref_ymd - timedelta(days=2)
        desc = "그저께" if "그저께" in text else "그제"
        return target_date.strftime("%Y-%m-%d"), desc, f"{target_date.month}월 {target_date.day}일 ({desc})"

    # 4. 어제
    if "어제" in text:
        target_date = ref_ymd - timedelta(days=1)
        return target_date.strftime("%Y-%m-%d"), "어제", f"{target_date.month}월 {target_date.day}일 (어제)"

    # 5. 오늘 / 방금
    if "오늘" in text or "방금" in text:
        desc = "오늘" if "오늘" in text else "방금"
        return ref_ymd.strftime("%Y-%m-%d"), desc, f"{ref_ymd.month}월 {ref_ymd.day}일 ({desc})"

    # 6. N일 전
    match = re.search(r"(\d+)\s*일\s*전", text)
    if match:
        days = int(match.group(1))
        target_date = ref_ymd - timedelta(days=days)
        desc = f"{days}일 전"
        return target_date.strftime("%Y-%m-%d"), desc, f"{target_date.month}월 {target_date.day}일 ({desc})"

    # 7. N주 전
    match = re.search(r"(\d+)\s*주\s*전", text)
    if match:
        weeks = int(match.group(1))
        target_date = ref_ymd - timedelta(weeks=weeks)
        desc = f"{weeks}주 전"
        return target_date.strftime("%Y-%m-%d"), desc, f"{target_date.month}월 {target_date.day}일 ({desc})"

    # 8. M월 D일
    match = re.search(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일", text)
    if match:
        m, d = int(match.group(1)), int(match.group(2))
        try:
            target_date = datetime(ref_ymd.year, m, d).date()
            if target_date > ref_ymd:
                target_date = datetime(ref_ymd.year - 1, m, d).date()
            return target_date.strftime("%Y-%m-%d"), f"{m}월 {d}일", f"{m}월 {d}일"
        except ValueError:
            pass

    return None, None, None


class PainChatService:
    async def respond(self, messages: list[PainChatMessage]) -> PainChatData:
        api_key = config.GEMINI_API_KEY
        if not api_key:
            raise AppError("Gemini API 키가 설정되지 않았습니다.", status_code=503)

        client = genai.Client(api_key=api_key)

        kst = timezone(timedelta(hours=9))
        now_kst = datetime.now(kst)
        today_str = now_kst.strftime("%Y-%m-%d (%A)")

        yesterday = now_kst - timedelta(days=1)
        days_since_sat = (now_kst.weekday() - 5) % 7
        if days_since_sat == 0:
            days_since_sat = 7
        last_sat = now_kst - timedelta(days=days_since_sat)

        days_since_fri = (now_kst.weekday() - 4) % 7
        if days_since_fri == 0:
            days_since_fri = 7
        last_fri = now_kst - timedelta(days=days_since_fri)

        last_mon = now_kst - timedelta(days=7)

        instructions = f"""You support a Korean health-recording form. Do not diagnose, prescribe, or reassure medically.
Today's reference date is: {now_kst.year}년 {now_kst.month}월 {now_kst.day}일 ({today_str}).

Relative Date Calculation Rules (Reference: Today is {now_kst.month}월 {now_kst.day}일):
- '오늘', '방금': '{now_kst.strftime("%Y-%m-%d")}' ({now_kst.month}월 {now_kst.day}일)
- '어제': '{yesterday.strftime("%Y-%m-%d")}' ({yesterday.month}월 {yesterday.day}일)
- '그저께', '그제': '{(now_kst - timedelta(days=2)).strftime("%Y-%m-%d")}'
- '저번주 토요일', '지난 토요일', '지난주 토요일': '{last_sat.strftime("%Y-%m-%d")}' ({last_sat.month}월 {last_sat.day}일)
- '저번주 금요일', '지난 금요일', '지난주 금요일': '{last_fri.strftime("%Y-%m-%d")}' ({last_fri.month}월 {last_fri.day}일)
- '저번주 월요일', '지난주 월요일': '{last_mon.strftime("%Y-%m-%d")}' ({last_mon.month}월 {last_mon.day}일)
- 'N일 전': exactly N days before today ({now_kst.strftime("%Y-%m-%d")}).

Extraction Rules for PainDraft:
1. body_area: Clearly distinguish Left/Right/Both side when mentioned (e.g., '오른쪽 손목', '왼쪽 무릎', '오른쪽 발목', '오른쪽 어깨', '양쪽 발목', '허리'). If the body part has left/right and user didn't mention which side, ask '오른쪽인가요, 왼쪽인가요?' in assistant_message.
2. intensity: Number from 0 to 10.
3. sensation: Sensation description (e.g., '시큰거림', '욱신거림', '찌릿찌릿함', '찌르는 듯함', '뻐근함', '화끈거림').
4. onset_description: User's original timing phrase (e.g., '저번주 수요일', '저번주 토요일', '어제', '3일 전').
5. onset_date: Exact calculated ISO date (YYYY-MM-DD).
6. note: Natural statement describing the pain context without repeating field labels (e.g., '손목이 시큰거리며 거슬리게 아픔', '오른쪽 발목이 찌릿찌릿함').

Follow-up Rules:
- Ask one concise Korean follow-up question for missing body_area or intensity.
- missing_fields may only contain 'body_area' or 'intensity'.
- If the user mentions severe chest pain, breathing difficulty, loss of consciousness, stroke-like symptoms, severe bleeding, or self-harm, set emergency_notice to a short Korean emergency-care instruction; still do not diagnose.
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
            chat_data = PainChatData.model_validate_json(response.text)
            self._post_process_draft(chat_data.draft, messages, now_kst)
            return chat_data
        except Exception as error:
            raise AppError("통증 대화 응답 데이터 구조화에 실패했습니다.", status_code=503) from error

    def _post_process_draft(self, draft, messages: list[PainChatMessage], now: datetime) -> None:
        if not draft:
            return

        all_user_text = " ".join(m.content for m in messages if m.role == "user")
        parsed_ymd, parsed_desc, parsed_fmt = parse_korean_onset(all_user_text, now)

        if parsed_ymd:
            draft.onset_date = parsed_ymd
            draft.onset_description = parsed_desc
            draft.onset_formatted = parsed_fmt
        elif draft.onset_date:
            try:
                dt = datetime.strptime(draft.onset_date, "%Y-%m-%d")
                d_desc = f" ({draft.onset_description})" if draft.onset_description and draft.onset_description != draft.onset_date else ""
                draft.onset_formatted = f"{dt.month}월 {dt.day}일{d_desc}"
            except Exception:
                draft.onset_formatted = draft.onset_date
        elif draft.onset_description:
            draft.onset_formatted = draft.onset_description

        # Build clean structured multi-line text
        lines: list[str] = []
        if draft.body_area:
            lines.append(f"부위: {draft.body_area}")
        if draft.intensity is not None:
            lines.append(f"통증강도: {draft.intensity}/10")
        if draft.sensation:
            lines.append(f"양상: {draft.sensation}")
        if draft.onset_formatted:
            lines.append(f"시작시각: {draft.onset_formatted}")
        if draft.note:
            lines.append(f"내용: {draft.note}")
        elif all_user_text:
            lines.append(f"내용: {all_user_text}")

        if lines:
            draft.formatted_summary = "\n".join(lines)

