"""식품의약품안전처 식품영양성분 데이터베이스 API 클라이언트.

외부 API 원문이나 인증키는 응답·로그에 남기지 않는다.
FOOD_NUTRITION_API_KEY 및 MFDS_API_KEY 가 없거나 외부 API가 응답하지 않을 경우,
표준 내장 카탈로그(food_nutrition_catalog)로 즉각 안전 폴백하여 서비스 중단을 방지한다.
조회 결과는 600초간 메모리 캐시한다.
"""

from __future__ import annotations

import logging
import re
import time
import urllib.parse
from typing import Any, Protocol

import httpx

from app.core import config
from app.dtos.food_nutrition import FoodNutritionItem, FoodNutritionSearchResult
from app.services.food_nutrition_catalog import search_food_catalog

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 5.0
_CACHE_SECONDS = 600.0

# 공공데이터포털 식약처 식품영양성분 API 엔드포인트 후보
_FOOD_NUTR_URL_CPNT = "https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo01/getFoodNtrCpntDbInq01"
_FOOD_NUTR_URL_LIST = "http://apis.data.go.kr/1471000/FoodNtrIrdntInfoService1/getFoodNtrItdntList1"

# 메모리 캐시: query -> (timestamp, FoodNutritionSearchResult)
_cache: dict[str, tuple[float, FoodNutritionSearchResult]] = {}


def _mask_credentials(text: str, secret: str | None = None) -> str:
    """오류 메시지나 URL에서 인증키를 마스킹하여 로그 노출을 방지한다."""
    if not text:
        return text
    masked = re.sub(r"serviceKey=[^&'\"]+", "serviceKey=***", text)
    if secret and secret in masked:
        masked = masked.replace(secret, "***")
    return masked


def _cache_get(key: str) -> FoodNutritionSearchResult | None:
    entry = _cache.get(key)
    if entry and (time.monotonic() - entry[0]) < _CACHE_SECONDS:
        return entry[1]
    return None


def _cache_set(key: str, result: FoodNutritionSearchResult) -> None:
    _cache[key] = (time.monotonic(), result)


def _safe_float(val: Any) -> float | None:
    """문자열 숫자를 float로 안전 변환."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    text = str(val).strip().replace(",", "")
    if not text or text == "-" or text == "N/A":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _parse_cpnt_item(raw: dict[str, Any]) -> FoodNutritionItem:
    """FoodNtrCpntDbInfo01 단일 항목 변환."""
    name = str(raw.get("FOOD_NM_KR") or raw.get("DESC_KOR") or raw.get("food_name") or "").strip()
    serving = str(raw.get("SERVING_SIZE") or raw.get("AMT_NUM1") or raw.get("SUB_REF_NAME") or "").strip() or None
    return FoodNutritionItem(
        food_name=name,
        serving_size=serving,
        calories_kcal=_safe_float(raw.get("AMT_NUM1") or raw.get("NUTR_CONT1")),
        carbohydrate_g=_safe_float(raw.get("AMT_NUM7") or raw.get("NUTR_CONT2")),
        protein_g=_safe_float(raw.get("AMT_NUM3") or raw.get("NUTR_CONT3")),
        fat_g=_safe_float(raw.get("AMT_NUM4") or raw.get("NUTR_CONT4")),
        sugar_g=_safe_float(raw.get("AMT_NUM8") or raw.get("NUTR_CONT5")),
        sodium_mg=_safe_float(raw.get("AMT_NUM14") or raw.get("NUTR_CONT6")),
        cholesterol_mg=_safe_float(raw.get("AMT_NUM24") or raw.get("NUTR_CONT7")),
        saturated_fat_g=_safe_float(raw.get("AMT_NUM25") or raw.get("NUTR_CONT8")),
        trans_fat_g=_safe_float(raw.get("AMT_NUM26") or raw.get("NUTR_CONT9")),
        maker_name=raw.get("MAKER_NAME") or raw.get("ANIMAL_PLANT"),
    )


def _parse_list_item(raw: dict[str, Any]) -> FoodNutritionItem:
    """FoodNtrIrdntInfoService1 단일 항목 변환."""
    name = str(raw.get("DESC_KOR") or raw.get("FOOD_NM_KR") or "").strip()
    serving = str(raw.get("SERVING_WT") or raw.get("SERVING_SIZE") or "").strip() or None
    if serving and not serving.endswith("g") and not serving.endswith("ml"):
        serving = f"{serving}g"
    return FoodNutritionItem(
        food_name=name,
        serving_size=serving,
        calories_kcal=_safe_float(raw.get("NUTR_CONT1")),
        carbohydrate_g=_safe_float(raw.get("NUTR_CONT2")),
        protein_g=_safe_float(raw.get("NUTR_CONT3")),
        fat_g=_safe_float(raw.get("NUTR_CONT4")),
        sugar_g=_safe_float(raw.get("NUTR_CONT5")),
        sodium_mg=_safe_float(raw.get("NUTR_CONT6")),
        cholesterol_mg=_safe_float(raw.get("NUTR_CONT7")),
        saturated_fat_g=_safe_float(raw.get("NUTR_CONT8")),
        trans_fat_g=_safe_float(raw.get("NUTR_CONT9")),
        maker_name=raw.get("ANIMAL_PLANT") or raw.get("BSSH_NM"),
    )


def _format_nutr_lines(food: FoodNutritionItem) -> list[str]:
    lines: list[str] = []
    if food.calories_kcal is not None:
        lines.append(f"열량 {food.calories_kcal:g}kcal")
    if food.sodium_mg is not None:
        lines.append(f"나트륨 {food.sodium_mg:g}mg")
    if food.sugar_g is not None:
        lines.append(f"당류 {food.sugar_g:g}g")
    if food.carbohydrate_g is not None:
        lines.append(f"탄수화물 {food.carbohydrate_g:g}g")
    if food.protein_g is not None:
        lines.append(f"단백질 {food.protein_g:g}g")
    if food.fat_g is not None:
        lines.append(f"지방 {food.fat_g:g}g")
    return lines


def _format_cautions(food: FoodNutritionItem) -> list[str]:
    cautions: list[str] = []
    if food.sodium_mg is not None and food.sodium_mg >= 1500.0:
        cautions.append("나트륨 함량이 1일 권장량(2,000mg)의 절반 이상으로 높아 국물 섭취를 줄이시길 권장합니다.")
    elif food.sodium_mg is not None and food.sodium_mg >= 1000.0:
        cautions.append("나트륨 함량이 다소 높은 편이므로 고혈압이나 신장 질환이 있으신 경우 섭취량 조절을 권장합니다.")

    if food.sugar_g is not None and food.sugar_g >= 25.0:
        cautions.append(
            "단순당 함량이 높아 혈당 급상승에 주의가 필요하며, 당뇨 관리 중이시라면 섭취량을 제한하는 것이 좋습니다."
        )
    return cautions


def _build_food_nutrition_summary(query: str, items: list[FoodNutritionItem]) -> str:
    """사용자에게 전달할 간결하고 정갈한 핵심 영양 요약 메시지를 생성 (이모티콘 미사용)."""
    if not items:
        return f"'{query}'에 대한 식품영양성분 정보를 찾지 못했습니다. 보다 정확한 음식명이나 브랜드명을 확인해 주세요."

    food = items[0]
    parts: list[str] = [f"[식품영양성분 정보: {food.food_name}]"]
    if food.serving_size:
        parts.append(f"1회 제공량: {food.serving_size}")

    nutr_lines = _format_nutr_lines(food)
    if nutr_lines:
        parts.append(f"주요 영양성분: {', '.join(nutr_lines)}")

    cautions = _format_cautions(food)
    if cautions:
        parts.append(f"주의: {' '.join(cautions)}")

    parts.append("개인의 기저질환 및 건강 목표에 따라 적정 섭취량을 조절하세요.")
    return "\n".join(parts)


def _extract_primary_food_name(food_name: str) -> str:
    """질문이나 복합어에서 핵심 음식 명칭을 추출한다."""
    clean = food_name.strip()

    # 복수 음식 구분자 먼저 분리 (예: "삼겹살이랑 소주" -> "삼겹살")
    for sep in (",", "/", "&", "+", "이랑", "하고", "과", "와"):
        if sep in clean:
            parts = [p.strip() for p in clean.split(sep) if p.strip()]
            if parts:
                clean = parts[0]
                break

    # 물음표 등 문장 부호 제거
    clean = re.sub(r"[?!.,~]+$", "", clean).strip()

    # 후미 서술어 및 질문 어미
    suffixes = (
        "알려주세요",
        "알려줘",
        "얼마나돼",
        "얼마나되",
        "얼마나",
        "얼마야",
        "어때요",
        "어때",
        "많나요",
        "많아요",
        "많아",
        "높나요",
        "높아요",
        "높아",
        "괜찮을까",
        "괜찮아요",
        "괜찮아",
        "될까요",
        "되나요",
        "될까",
        "돼요",
        "돼",
        "되",
        "먹어도",
        "섭취해도",
        "마셔도",
        "칼로리",
        "열량",
        "영양성분",
        "영양정보",
        "나트륨",
        "당류",
        "당분",
        "탄수화물",
        "단백질",
        "지방",
        "은",
        "는",
        "을",
        "를",
    )

    changed = True
    while changed:
        changed = False
        clean = clean.strip()
        for suffix in suffixes:
            if clean.endswith(suffix) and len(clean) > len(suffix):
                clean = clean[: -len(suffix)].strip()
                changed = True
                break

    return clean or food_name.strip()


class FoodNutritionClientProtocol(Protocol):
    async def search_food_nutrition(self, food_name: str) -> FoodNutritionSearchResult: ...


class FoodNutritionClient:
    """식약처 식품영양성분 DB 클라이언트 (API 및 로컬 표준 카탈로그 지원)."""

    async def _fetch_from_api(
        self,
        client: httpx.AsyncClient,
        clean_name: str,
        api_key: str,
        errors: list[str],
    ) -> list[FoodNutritionItem]:
        # 1-1. FoodNtrCpntDbInfo01 엔드포인트 시도
        parsed_items: list[FoodNutritionItem] = []
        try:
            params_cpnt = urllib.parse.urlencode(
                {"FOOD_NM_KR": clean_name, "type": "json", "numOfRows": "3", "pageNo": "1"}
            )
            url_cpnt = f"{_FOOD_NUTR_URL_CPNT}?serviceKey={api_key}&{params_cpnt}"
            resp = await client.get(url_cpnt)
            if resp.status_code == 200:
                raw_items = (resp.json().get("body") or {}).get("items") or []
                if isinstance(raw_items, dict):
                    raw_items = [raw_items]
                parsed_items = [_parse_cpnt_item(r) for r in raw_items if r]
        except Exception as exc:
            safe_err = _mask_credentials(str(exc), api_key)
            logger.debug("식품영양성분 API(CPNT) 호출 실패 (%s): %s", type(exc).__name__, safe_err)
            errors.append(f"공공 API(CPNT) 조회 예외: {type(exc).__name__}")

        # 1-2. 항목이 없고 오류 시 FoodNtrIrdntInfoService1 엔드포인트 시도
        if not parsed_items:
            try:
                params_list = urllib.parse.urlencode(
                    {"desc_kor": clean_name, "_type": "json", "numOfRows": "3", "pageNo": "1"}
                )
                url_list = f"{_FOOD_NUTR_URL_LIST}?serviceKey={api_key}&{params_list}"
                resp_list = await client.get(url_list)
                if resp_list.status_code == 200:
                    raw_list = (resp_list.json().get("body") or {}).get("items") or []
                    if isinstance(raw_list, dict):
                        raw_list = [raw_list]
                    parsed_items = [_parse_list_item(r) for r in raw_list if r]
            except Exception as exc_list:
                safe_err_list = _mask_credentials(str(exc_list), api_key)
                logger.debug("식품영양성분 API(LIST) 호출 실패 (%s): %s", type(exc_list).__name__, safe_err_list)
                errors.append(f"공공 API(LIST) 조회 예외: {type(exc_list).__name__}")

        return parsed_items

    async def search_food_nutrition(self, food_name: str) -> FoodNutritionSearchResult:
        clean_name = _extract_primary_food_name(food_name)
        cache_key = clean_name.lower().replace(" ", "")
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        api_key = config.FOOD_NUTRITION_API_KEY or config.MFDS_API_KEY
        errors: list[str] = []
        parsed_items: list[FoodNutritionItem] = []

        # 1. API 호출 시도 (API 키가 있는 경우)
        if api_key:
            async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
                parsed_items = await self._fetch_from_api(client, clean_name, api_key, errors)

        # 2. 로컬 표준 카탈로그 폴백
        if not parsed_items:
            parsed_items = search_food_catalog(clean_name, limit=3)

        message = _build_food_nutrition_summary(clean_name, parsed_items)
        result = FoodNutritionSearchResult(
            query=clean_name,
            items=parsed_items,
            message=message,
            errors=errors,
        )
        _cache_set(cache_key, result)
        return result
