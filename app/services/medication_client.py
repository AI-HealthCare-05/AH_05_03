"""식약처 e약은요 API + DUR 품목정보 API 클라이언트.

외부 API 원문이나 인증키는 응답·로그에 남기지 않는다.
MFDS_API_KEY 가 없으면 API 호출 없이 빈 결과를 반환한다 (서비스 중단 방지).
결과는 600초간 메모리 캐시한다 (약품 정보는 실시간성 불필요).
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
import urllib.parse
from typing import Any, Protocol

import httpx

from app.core import config
from app.dtos.medication import DrugInfo, DrugInteractionItem, DurItem, MedicationSearchResult

logger = logging.getLogger(__name__)


def _mask_credentials(text: str, secret: str | None = None) -> str:
    """오류 메시지나 URL에서 인증키를 마스킹하여 로그 노출을 방지한다."""
    if not text:
        return text
    # 쿼리스트링 내 serviceKey 마스킹
    masked = re.sub(r"serviceKey=[^&'\"]+", "serviceKey=***", text)
    # 혹시 키 원문이 메시지에 그대로 포함된 경우 마스킹
    if secret and secret in masked:
        masked = masked.replace(secret, "***")
    return masked


_TIMEOUT_SECONDS = 5.0
_CACHE_SECONDS = 600.0
_CACHE_MAX_ENTRIES = 256

# 식약처 공공데이터포털 엔드포인트
_EASYDR_URL = "https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList"
_DUR_URL = "https://apis.data.go.kr/1471000/DURPrdlstInfoService03/getDurPrdlstInfoList03"
_DUR_USJNT_URL = "https://apis.data.go.kr/1471000/DURPrdlstInfoService03/getUsjntTabooInfoList03"

# 메모리 캐시: query → (timestamp, MedicationSearchResult)
_cache: dict[str, tuple[float, MedicationSearchResult]] = {}


class MedicationClientProtocol(Protocol):
    async def search_medication(
        self, drug_name: str, target_drug_name: str | None = None
    ) -> MedicationSearchResult: ...


def _cache_get(key: str) -> MedicationSearchResult | None:
    entry = _cache.get(key)
    if entry and (time.monotonic() - entry[0]) < _CACHE_SECONDS:
        return entry[1]
    return None


def _cache_set(key: str, result: MedicationSearchResult) -> None:
    """조회에 성공한 결과만 싣는다.

    **실패를 실으면 10분 동안 굳는다.** 일시적인 타임아웃 한 번으로 "찾지 못했습니다"
    가 캐시에 박혀, API 가 돌아온 뒤에도 그 약을 묻는 모든 사용자에게 같은 답이 나간다.
    조회 자체는 성공했는데 등록 약품이 없는 경우(errors 가 빈 경우)는 사실이므로 싣는다.
    """
    if result.errors:
        return

    now = time.monotonic()
    # 읽을 때만 만료를 보면 지워지지 않은 항목이 쌓인다. 약품명은 대화에서 오므로
    # 종류에 상한이 없고, 오래 뜨는 프로세스에서 그대로 메모리 증가가 된다.
    for stale in [k for k, (ts, _) in _cache.items() if (now - ts) >= _CACHE_SECONDS]:
        del _cache[stale]
    if len(_cache) >= _CACHE_MAX_ENTRIES:
        del _cache[min(_cache, key=lambda k: _cache[k][0])]
    _cache[key] = (now, result)


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


def _parse_dur_interaction_items(
    raw_list: list[dict[str, Any]], target_drug_keyword: str | None = None
) -> list[DrugInteractionItem]:
    """DUR 병용금기 API 응답에서 상호작용 항목 목록 파싱.

    target_drug_keyword 가 지정된 경우, 상대 의약품명(MIXTURE_ITEM_NAME) 또는
    상대 성분명에 해당 키워드가 포함된 항목만 필터링한다.
    """
    items: list[DrugInteractionItem] = []
    clean_keyword = target_drug_keyword.strip().lower() if target_drug_keyword else None

    for raw in raw_list:
        item_name = str(raw.get("ITEM_NAME") or raw.get("itemName") or "").strip()
        mix_item_name = str(raw.get("MIXTURE_ITEM_NAME") or raw.get("mixtureItemName") or "").strip()
        ingr_a = raw.get("MAIN_INGR") or raw.get("mainIngr") or raw.get("MATERIAL_NAME")
        ingr_b = raw.get("MIXTURE_MAIN_INGR") or raw.get("mixtureMainIngr") or raw.get("MIXTURE_MATERIAL_NAME")
        prohbt = str(
            raw.get("PROHBT_CONTENT")
            or raw.get("prohbtContent")
            or raw.get("prohibitContent")
            or raw.get("prhibtContent")
            or ""
        ).strip()
        type_name = str(raw.get("TYPE_NAME") or raw.get("typeName") or "병용금기").strip()

        if not item_name or not mix_item_name:
            continue

        if clean_keyword:
            mix_lower = mix_item_name.lower()
            ingr_b_lower = str(ingr_b or "").lower()
            if clean_keyword not in mix_lower and clean_keyword not in ingr_b_lower:
                continue

        items.append(
            DrugInteractionItem(
                drug_a=item_name,
                drug_b=mix_item_name,
                ingredient_a=str(ingr_a).strip() if ingr_a else None,
                ingredient_b=str(ingr_b).strip() if ingr_b else None,
                prohibition_content=prohbt or "병용 복용 시 부작용 또는 약효 이상 위험",
                type_name=type_name,
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


def _build_interaction_summary_message(
    drug_a: str,
    drug_b: str,
    interactions: list[DrugInteractionItem],
    items: list[DrugInfo],
) -> str:
    """두 의약품 병용 상호작용 문의에 대한 요약 메시지 생성 (이모티콘 미사용)."""
    if interactions:
        primary = interactions[0]
        parts = [
            f"[식약처 DUR 병용금기 주의: {drug_a} + {drug_b}]",
            f"병용금기 사유: {primary.prohibition_content}",
            f"기준 의약품: {primary.drug_a}" + (f" ({primary.ingredient_a})" if primary.ingredient_a else ""),
            f"상대 의약품: {primary.drug_b}" + (f" ({primary.ingredient_b})" if primary.ingredient_b else ""),
            "두 의약품은 함께 복용 시 부작용 위험이 있어 식약처 고시 병용금기 대상입니다.",
            "임의로 함께 복용하지 마시고, 반드시 의사 또는 약사와 상담하여 대체 약물이나 복용 간격을 지도받으시기 바랍니다.",
        ]
        return "\n".join(parts)

    parts = [
        f"[식약처 DUR 병용금기 확인: {drug_a} + {drug_b}]",
        "식약처 DUR 병용금기 데이터베이스상 두 약품 간의 직접적인 병용금기 항목은 확인되지 않았습니다.",
    ]
    if items:
        drug_summaries: list[str] = []
        for d in items[:2]:
            if d.efcy_qesitm:
                first_sentence = d.efcy_qesitm.split(".")[0].strip()
                drug_summaries.append(f"- {d.item_name}: {first_sentence}.")
        if drug_summaries:
            parts.append("각 약품 정보:")
            parts.extend(drug_summaries)

    parts.append(
        "다만 개인의 기저질환, 복용 용량, 성분 중복 여부에 따라 상호작용이 있을 수 있으니 자세한 복약 지도는 의사 또는 약사와 상의하시기 바랍니다."
    )
    return "\n".join(parts)


# 약품명을 가르는 자리.
#
# **한글 조사는 앞말에 붙고 뒤에 공백이 온다**("타이레놀과 게보린"). 그래서 조사를
# 어디서나 찾으면 약품명 안이 잘린다 — `와파린`은 `파린`, `베아제과립`은 `베아제`가
# 됐다. 특히 와파린은 항응고제라 상호작용을 잘못 조회하면 안내가 어긋난다.
# 앞에 글자가 있고 뒤에 공백이 오는 자리에서만 조사로 인정한다.
_DRUG_NAME_SEPARATOR = re.compile(r"\s*[,/&+]\s*|(?<=\S)(?:이랑|하고|과|와)\s+")


def _extract_primary_drug_name(drug_name: str) -> str:
    clean = drug_name.strip()
    parts = [p.strip() for p in _DRUG_NAME_SEPARATOR.split(clean) if p.strip()]
    return parts[0] if parts else clean


def _extract_drug_names(text: str) -> list[str]:
    """구분자나 조사로 연결된 텍스트에서 약품명 목록을 추출한다."""
    clean = text.strip()
    parts = [p.strip() for p in _DRUG_NAME_SEPARATOR.split(clean) if p.strip()]
    return parts if parts else ([clean] if clean else [])


async def _fetch_drug_info(
    client: httpx.AsyncClient, api_key: str, drug_name: str, errors: list[str]
) -> DrugInfo | None:
    try:
        extra_params = urllib.parse.urlencode({"itemName": drug_name, "type": "json", "numOfRows": "1", "pageNo": "1"})
        url_easydr = f"{_EASYDR_URL}?serviceKey={api_key}&{extra_params}"
        resp = await client.get(url_easydr)
        resp.raise_for_status()
        data = resp.json()
        body = data.get("body") or {}
        raw_items = body.get("items") or []
        if isinstance(raw_items, dict):
            raw_items = [raw_items]
        parsed = [_parse_easydr_item(r) for r in raw_items if r]
        return parsed[0] if parsed else None
    except Exception as exc:
        safe_err = _mask_credentials(str(exc), api_key)
        logger.warning("e약은요 API 오류 (%s): %s", type(exc).__name__, safe_err)
        errors.append(f"의약품 '{drug_name}' 정보 조회 실패: {type(exc).__name__}")
        return None


async def _fetch_dur_usjnt(
    client: httpx.AsyncClient, api_key: str, item_name: str, errors: list[str]
) -> list[dict[str, Any]]:
    try:
        extra_params_usjnt = urllib.parse.urlencode(
            {"itemName": item_name, "type": "json", "numOfRows": "50", "pageNo": "1"}
        )
        url_usjnt = f"{_DUR_USJNT_URL}?serviceKey={api_key}&{extra_params_usjnt}"
        resp_usjnt = await client.get(url_usjnt)
        resp_usjnt.raise_for_status()
        data_usjnt = resp_usjnt.json()
        body_usjnt = data_usjnt.get("body") or {}
        raw_usjnt = body_usjnt.get("items") or []
        if isinstance(raw_usjnt, dict):
            raw_usjnt = [raw_usjnt]
        return [r for r in raw_usjnt if r]
    except Exception as exc:
        safe_err = _mask_credentials(str(exc), api_key)
        logger.warning("DUR 병용금기 API 오류 (%s): %s", type(exc).__name__, safe_err)
        errors.append(f"DUR 병용금기 조회 실패: {type(exc).__name__}")
        return []


class MedicationClient:
    """식약처 e약은요 및 DUR 품목정보 클라이언트."""

    async def _search_single_medication(
        self, client: httpx.AsyncClient, api_key: str, clean_name: str
    ) -> MedicationSearchResult:
        cache_key = f"drug:{clean_name.lower()}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        errors: list[str] = []

        async def fetch_easydr() -> list[DrugInfo]:
            try:
                extra_params = urllib.parse.urlencode(
                    {"itemName": clean_name, "type": "json", "numOfRows": "3", "pageNo": "1"}
                )
                url_easydr = f"{_EASYDR_URL}?serviceKey={api_key}&{extra_params}"
                resp = await client.get(url_easydr)
                resp.raise_for_status()
                data = resp.json()
                body = data.get("body") or {}
                raw_items = body.get("items") or []
                if isinstance(raw_items, dict):
                    raw_items = [raw_items]
                return [_parse_easydr_item(r) for r in raw_items if r]
            except Exception as exc:
                safe_err = _mask_credentials(str(exc), api_key)
                logger.warning("e약은요 API 오류 (%s): %s", type(exc).__name__, safe_err)
                errors.append(f"의약품 기본 정보 조회 실패: {type(exc).__name__}")
                return []

        async def fetch_dur() -> list[DurItem]:
            try:
                extra_params_dur = urllib.parse.urlencode(
                    {"itemName": clean_name, "type": "json", "numOfRows": "10", "pageNo": "1"}
                )
                url_dur = f"{_DUR_URL}?serviceKey={api_key}&{extra_params_dur}"
                resp_dur = await client.get(url_dur)
                resp_dur.raise_for_status()
                dur_data = resp_dur.json()
                dur_body = dur_data.get("body") or {}
                dur_raw = dur_body.get("items") or []
                if isinstance(dur_raw, dict):
                    dur_raw = [dur_raw]
                return _parse_dur_items([r for r in dur_raw if r])
            except Exception as exc:
                safe_err = _mask_credentials(str(exc), api_key)
                logger.warning("DUR API 오류 (%s): %s", type(exc).__name__, safe_err)
                errors.append(f"DUR 품목정보 조회 실패: {type(exc).__name__}")
                return []

        # e약은요와 DUR 품목정보를 병렬 조회
        drug_items, dur_items_parsed = await asyncio.gather(fetch_easydr(), fetch_dur())

        if drug_items and dur_items_parsed:
            drug_items[0].dur_items = dur_items_parsed

        result = MedicationSearchResult(
            query=clean_name,
            items=drug_items,
            message=_build_summary_message(clean_name, drug_items),
            errors=errors,
        )
        _cache_set(cache_key, result)
        return result

    async def _search_medication_interaction(
        self, client: httpx.AsyncClient, api_key: str, drug_a: str, drug_b: str
    ) -> MedicationSearchResult:
        # 두 약품명 정렬 기반 양방향 캐시 키
        sorted_names = sorted([drug_a.lower(), drug_b.lower()])
        cache_key = f"dur_usjnt:{sorted_names[0]}:{sorted_names[1]}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        errors: list[str] = []

        # 4개 비동기 요청을 한 번에 병렬 실행 (두 약품의 e약은요 정보 및 양방향 DUR 병용금기)
        item_a, item_b, raw_usjnt_a, raw_usjnt_b = await asyncio.gather(
            _fetch_drug_info(client, api_key, drug_a, errors),
            _fetch_drug_info(client, api_key, drug_b, errors),
            _fetch_dur_usjnt(client, api_key, drug_a, errors),
            _fetch_dur_usjnt(client, api_key, drug_b, errors),
        )

        all_drug_items: list[DrugInfo] = []
        if item_a:
            all_drug_items.append(item_a)
        if item_b:
            all_drug_items.append(item_b)

        # 양방향 결과 파싱: a -> b 검사 후 없으면 b -> a 검사
        interaction_items = _parse_dur_interaction_items(raw_usjnt_a, drug_b)
        if not interaction_items:
            interaction_items = _parse_dur_interaction_items(raw_usjnt_b, drug_a)

        has_danger = len(interaction_items) > 0
        message = _build_interaction_summary_message(drug_a, drug_b, interaction_items, all_drug_items)

        result = MedicationSearchResult(
            query=f"{drug_a}, {drug_b}",
            items=all_drug_items,
            interaction_items=interaction_items,
            has_interaction_danger=has_danger,
            target_drug_name=drug_b,
            message=message,
            errors=errors,
        )
        _cache_set(cache_key, result)
        return result

    async def search_medication(self, drug_name: str, target_drug_name: str | None = None) -> MedicationSearchResult:
        api_key = config.MFDS_API_KEY
        if not api_key:
            logger.debug("MFDS_API_KEY 미설정 — 의약품 조회 건너뜀")
            return MedicationSearchResult(
                query=f"{drug_name}, {target_drug_name}" if target_drug_name else drug_name,
                message="식약처 공공 API 키가 설정되지 않아 공식 DB 조회가 생략되었습니다. 일반 의약품 지식을 바탕으로 안내해 드립니다.",
            )

        clean_name = drug_name.strip()
        target = target_drug_name.strip() if target_drug_name and target_drug_name.strip() else None

        # target_drug_name이 없고, drug_name에 여러 약품명이 나열된 경우 자동 분리
        if not target:
            extracted = _extract_drug_names(clean_name)
            if len(extracted) >= 2:
                drug_a = extracted[0]
                drug_b = extracted[1]
            else:
                drug_a = _extract_primary_drug_name(clean_name)
                drug_b = None
        else:
            drug_a = _extract_primary_drug_name(clean_name)
            drug_b = _extract_primary_drug_name(target)

        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            if drug_b:
                return await self._search_medication_interaction(client, api_key, drug_a, drug_b)
            return await self._search_single_medication(client, api_key, drug_a)
