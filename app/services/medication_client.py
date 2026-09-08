"""식약처 e약은요 API + DUR 품목정보 API 클라이언트.

외부 API 원문이나 인증키는 응답·로그에 남기지 않는다.
MFDS_API_KEY 가 없으면 API 호출 없이 빈 결과를 반환한다 (서비스 중단 방지).
결과는 600초간 메모리 캐시한다 (약품 정보는 실시간성 불필요).
"""

from __future__ import annotations

import logging
import time
import urllib.parse
from typing import Any, Protocol

import httpx

from app.core import config
from app.dtos.medication import DrugInfo, DurItem, MedicationSearchResult

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 5.0
_CACHE_SECONDS = 600.0

# 식약처 공공데이터포털 엔드포인트
_EASYDR_URL = "https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList"
_DUR_URL = "https://apis.data.go.kr/1471000/DURPrdlstInfoService03/getDurPrdlstInfoList03"

# 메모리 캐시: query → (timestamp, MedicationSearchResult)
_cache: dict[str, tuple[float, MedicationSearchResult]] = {}


class MedicationClientProtocol(Protocol):
    async def search_medication(self, drug_name: str) -> MedicationSearchResult: ...


def _cache_get(key: str) -> MedicationSearchResult | None:
    entry = _cache.get(key)
    if entry and (time.monotonic() - entry[0]) < _CACHE_SECONDS:
        return entry[1]
    return None


def _cache_set(key: str, result: MedicationSearchResult) -> None:
    _cache[key] = (time.monotonic(), result)


def _parse_easydr_item(raw: dict[str, Any]) -> DrugInfo:
    """e약은요 API 단일 항목을 DrugInfo로 변환."""
    return DrugInfo(
        item_name=raw.get("itemName", ""),
        entp_name=raw.get("entpName"),
        class_name=raw.get("className"),
        efcy_qesitm=raw.get("efcyQesitm"),
        use_method_qesitm=raw.get("useMethodQesitm"),
        atpn_warn_qesitm=raw.get("atpnWarnQesitm"),
        atpn_qesitm=raw.get("atpnQesitm"),
        intrc_qesitm=raw.get("intrcQesitm"),
        se_qesitm=raw.get("seQesitm"),
        deposit_method_qesitm=raw.get("depositMethodQesitm"),
    )


def _parse_dur_items(raw_list: list[dict[str, Any]]) -> list[DurItem]:
    """DUR API 응답에서 금기/주의 항목 목록 파싱."""
    items: list[DurItem] = []
    for raw in raw_list:
        type_name = None
        for key in raw:
            if key.strip() == "TYPE_NAME":
                type_name = raw[key]
                break
        prohibition_type = (type_name or "").strip() or raw.get("prohibitContent") or raw.get("typeNm") or "주의"
        ingredient = raw.get("MATERIAL_NAME") or raw.get("ingdIngdNm") or raw.get("mixture")
        reason = raw.get("CANCEL_NAME") or raw.get("prhibtContent") or raw.get("remark")
        items.append(
            DurItem(
                prohibition_type=str(prohibition_type),
                ingredient_name=str(ingredient).split(",")[0].strip() if ingredient else None,
                reason=str(reason) if reason and reason != "정상" else None,
            )
        )
    return items


def _build_summary_message(drug_name: str, items: list[DrugInfo]) -> str:
    """사용자에게 전달할 간결하고 정갈한 핵심 요약 메시지를 생성 (이모티콘 미사용)."""
    if not items:
        return f"'{drug_name}'에 대한 식약처 등록 의약품 정보를 찾지 못했습니다. 정확한 약품명을 확인해 주세요."

    drug = items[0]
    parts: list[str] = [f"[식약처 의약품 정보: {drug.item_name}]"]
    if drug.entp_name:
        parts.append(f"제조사: {drug.entp_name}")

    if drug.efcy_qesitm:
        first_sentence = drug.efcy_qesitm.split(".")[0].strip()
        parts.append(f"효능·효과: {first_sentence}." if first_sentence else f"효능·효과: {drug.efcy_qesitm[:80]}")

    if drug.use_method_qesitm:
        first_use = drug.use_method_qesitm.split(".")[0].strip()
        parts.append(f"용법·용량: {first_use}." if first_use else f"용법·용량: {drug.use_method_qesitm[:80]}")

    if drug.dur_items:
        dur_summary = ", ".join(f"[{d.prohibition_type}] {d.ingredient_name or ''}" for d in drug.dur_items[:3])
        parts.append(f"DUR 주의·금기: {dur_summary}")
    elif drug.atpn_warn_qesitm or drug.atpn_qesitm:
        warn = (drug.atpn_warn_qesitm or drug.atpn_qesitm or "").strip()
        first_warn = warn.split(".")[0].strip()
        parts.append(f"주의사항: {first_warn}." if first_warn else f"주의사항: {warn[:80]}")

    parts.append("자세한 복약 지도는 의사 또는 약사와 상의하시기 바랍니다.")
    return "\n".join(parts)


class MedicationClient:
    """식약처 e약은요 + DUR API 클라이언트."""

    async def search_medication(self, drug_name: str) -> MedicationSearchResult:
        api_key = config.MFDS_API_KEY
        if not api_key:
            logger.debug("MFDS_API_KEY 미설정 — 의약품 조회 건너뜀")
            return MedicationSearchResult(
                query=drug_name,
                message="의약품 정보 서비스가 현재 설정되어 있지 않습니다.",
            )

        cache_key = drug_name.strip().lower()
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        errors: list[str] = []
        drug_items: list[DrugInfo] = []

        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            # 1) e약은요 API — 기본 약품 정보
            # 공공데이터포털 serviceKey는 이미 URL 인코딩된 형태로 발급되므로
            # httpx params=에 넣으면 이중 인코딩이 발생해 403이 난다.
            # serviceKey만 URL에 직접 붙이고 나머지 파라미터는 urllib.parse로 처리한다.
            try:
                extra_params = urllib.parse.urlencode(
                    {"itemName": drug_name, "type": "json", "numOfRows": "3", "pageNo": "1"}
                )
                url_easydr = f"{_EASYDR_URL}?serviceKey={api_key}&{extra_params}"
                resp = await client.get(url_easydr)
                resp.raise_for_status()
                data = resp.json()
                body = data.get("body") or {}
                raw_items = body.get("items") or []
                if isinstance(raw_items, dict):
                    raw_items = [raw_items]
                drug_items = [_parse_easydr_item(r) for r in raw_items if r]
            except Exception as exc:
                logger.warning("e약은요 API 오류: %s", exc)
                errors.append(f"의약품 기본 정보 조회 실패: {type(exc).__name__}")

            # 2) DUR API — 병용금기·연령금기·임부금기
            try:
                extra_params_dur = urllib.parse.urlencode(
                    {"itemName": drug_name, "type": "json", "numOfRows": "10", "pageNo": "1"}
                )
                url_dur = f"{_DUR_URL}?serviceKey={api_key}&{extra_params_dur}"
                resp_dur = await client.get(url_dur)
                resp_dur.raise_for_status()
                dur_data = resp_dur.json()
                dur_body = dur_data.get("body") or {}
                dur_raw = dur_body.get("items") or []
                if isinstance(dur_raw, dict):
                    dur_raw = [dur_raw]
                dur_items_parsed = _parse_dur_items([r for r in dur_raw if r])
                # 첫 번째 약품에 매핑
                if drug_items and dur_items_parsed:
                    drug_items[0].dur_items = dur_items_parsed
            except Exception as exc:
                logger.warning("DUR API 오류: %s", exc)
                errors.append(f"DUR 병용금기 조회 실패: {type(exc).__name__}")

        result = MedicationSearchResult(
            query=drug_name,
            items=drug_items,
            message=_build_summary_message(drug_name, drug_items),
            errors=errors,
        )
        _cache_set(cache_key, result)
        return result
