"""질병관리청 국가건강정보포털 건강정보검색 API 클라이언트.

`healthSearchListApi.do`/`healthSearchViewApi.do`는 공공데이터포털 스타일의
JSON/XML openAPI가 아니라, 포털 자신의 검색 화면이 쓰는 폼 기반 엔드포인트다
(POST, 응답이 HTML 조각). 정식 오픈API 문서가 없어 이 파일이 그 계약의 유일한
근거다 — 포털이 마크업을 바꾸면 파싱이 조용히 비어 버릴 수 있으니, 응답 형태가
바뀐 것 같으면 가장 먼저 여기를 의심한다.

인증키나 원문 HTML은 로그에 남기지 않는다. 키가 없거나 호출이 실패하면
`HealthKnowledgeCatalogClient`(수작업 카탈로그)로 조용히 폴백한다 — 서비스가
멈추는 것보다 좁은 근거로라도 답하는 편이 낫다.
"""

from __future__ import annotations

import html as html_lib
import logging
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from app.core import config
from app.core.config import Env
from app.dtos.health_knowledge import HealthKnowledgeItem, HealthKnowledgeSearchResult
from app.services.health_knowledge_catalog import HealthKnowledgeCatalogClient

logger = logging.getLogger(__name__)

_SEOUL = ZoneInfo("Asia/Seoul")
_LIST_URL = "https://health.kdca.go.kr/healthinfo/openapi/svcNew/healthSearchListApi.do"
_VIEW_URL = "https://health.kdca.go.kr/healthinfo/openapi/svcNew/healthSearchViewApi.do"
_VIEW_BASE_URL = (
    "https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do"
)
_TIMEOUT_SECONDS = 8.0
_MAX_ITEMS = 3
_SUMMARY_MAX_CHARS = 700

# 목록 응답의 각 결과 항목: <a onclick="javascript:fn_goView('6765','고혈압');">
_LIST_ITEM_PATTERN = re.compile(r"fn_goView\('(\d+)'\s*,\s*'([^']*)'\)")
# 상세 응답의 각 섹션 시작점: <div id="contentsDiv2" ... class="contents-DivN">
_SECTION_SPLIT_PATTERN = re.compile(r'<div\s+id="contentsDiv\d+"[^>]*>')
_H3_PATTERN = re.compile(r"<h3[^>]*>(.*?)</h3>", re.S)
_TAG_PATTERN = re.compile(r"<[^>]+>")
_WHITESPACE_PATTERN = re.compile(r"[ \t\r\f\v]+")
_BLANK_LINES_PATTERN = re.compile(r"\n{2,}")

# 요약문(있으면 최우선) > 개요 > 첫 섹션 순으로 summary 후보를 고른다.
_PREFERRED_SECTION_ORDER = ("요약문", "개요")

_TOKEN_SPLIT_PATTERN = re.compile(r"[\s,./?!·]+")
# 흔한 조사 하나만 뒤에 붙은 경우 떼어낸다 — 짧은 명사 키워드일수록 포털
# 검색이 잘 맞는다("당뇨에" 검색은 0건, "당뇨"는 매치된다).
_TRAILING_PARTICLE_PATTERN = re.compile(
    r"(?<=[가-힣]{2})(에게|한테|으로|에서|부터|까지|은|는|이|가|을|를|도|만|에|의|로|과|와)$"
)
_STOPWORDS = frozenset({"환자", "환자들", "안내", "정보", "방법", "정도", "관련", "대해", "알려줘", "뭐가", "어떤"})
_DISEASE_ALIASES: dict[str, tuple[str, ...]] = {
    "당뇨": ("당뇨", "당뇨병"),
    "고혈압": ("고혈압",),
    "이상지질혈증": ("이상지질혈증", "고지혈증"),
    "비만": ("비만",),
    "갑상선": ("갑상선",),
    "관절염": ("관절염",),
    "골다공증": ("골다공증",),
    "천식": ("천식",),
    "뇌졸중": ("뇌졸중", "뇌경색", "뇌출혈"),
    "심장질환": ("심장질환", "심근경색", "협심증"),
    "위염": ("위염", "위궤양"),
    "우울증": ("우울증", "우울"),
}
_INTENT_ALIASES: dict[str, tuple[str, ...]] = {
    "식이요법": ("식이요법", "식이", "식사", "식단", "좋은음식", "음식", "뭘먹", "먹어야", "영양"),
    "운동요법": ("운동요법", "운동법", "운동", "신체활동"),
    "예방": ("예방법", "예방"),
    "관리": ("관리", "자기관리"),
}
_PORTAL_QUERY_ALIASES: dict[tuple[str, str], str] = {
    ("당뇨", "식이요법"): "당뇨환자의 식이요법",
    ("고혈압", "식이요법"): "고혈압 환자의 식이요법",
}
_MAX_KEYWORD_ATTEMPTS = 6


def _matched_concepts(text: str, aliases: dict[str, tuple[str, ...]]) -> set[str]:
    compact = re.sub(r"\s+", "", text)
    return {canonical for canonical, words in aliases.items() if any(word in compact for word in words)}


def _significant_tokens(query: str) -> list[str]:
    """원문/enriched_query에서 조사를 뗀 의미 있는 단어만 뽑는다(2자 이상, 중복 제거)."""
    tokens: list[str] = []
    for token in _TOKEN_SPLIT_PATTERN.split(query):
        stripped = _TRAILING_PARTICLE_PATTERN.sub("", token)
        if len(stripped) >= 2 and stripped not in _STOPWORDS and stripped not in tokens:
            tokens.append(stripped)
    return tokens


def _candidate_keywords(query: str) -> list[str]:
    """포털 검색어 후보를 만든다. 원문 통째로 → 조사 뗀 단어들 순으로 시도한다.

    이 검색은 제목에 대한 단순 매칭이라 "당뇨에 좋은 음식 뭐가 있어" 같은
    문장 전체로는 안 걸리고 "당뇨"처럼 짧은 명사라야 걸린다.
    """
    diseases = _matched_concepts(query, _DISEASE_ALIASES)
    intents = _matched_concepts(query, _INTENT_ALIASES)
    portal_aliases = [
        alias
        for disease in diseases
        for intent in intents
        if (alias := _PORTAL_QUERY_ALIASES.get((disease, intent))) is not None
    ]
    disease_keywords = [next(iter(_DISEASE_ALIASES[disease])) for disease in diseases]
    candidates = [query, *portal_aliases, *disease_keywords, *_significant_tokens(query)]
    seen: list[str] = []
    for candidate in candidates:
        if candidate not in seen:
            seen.append(candidate)
    return seen[:_MAX_KEYWORD_ATTEMPTS]


def _is_relevant(title: str, query: str) -> bool:
    """질환과 질문 의도를 별도로 맞춰 다른 질환 자료나 엉뚱한 주제를 배제한다."""
    query_diseases = _matched_concepts(query, _DISEASE_ALIASES)
    title_diseases = _matched_concepts(title, _DISEASE_ALIASES)
    if query_diseases and not query_diseases.intersection(title_diseases):
        return False

    query_intents = _matched_concepts(query, _INTENT_ALIASES)
    title_intents = _matched_concepts(title, _INTENT_ALIASES)
    if query_intents and not query_intents.intersection(title_intents):
        return False

    if query_diseases or query_intents:
        return True

    significant_tokens = _significant_tokens(query)
    if not significant_tokens:
        return False
    matches = sum(1 for token in significant_tokens if token in title)
    required = min(2, len(significant_tokens))
    return matches >= required


def _strip_html(fragment: str) -> str:
    text = _TAG_PATTERN.sub(" ", fragment)
    text = html_lib.unescape(text)
    text = _WHITESPACE_PATTERN.sub(" ", text)
    text = _BLANK_LINES_PATTERN.sub("\n", text)
    return text.strip()


def _parse_list_items(body: str) -> list[tuple[str, str]]:
    return [(cntnts_sn, html_lib.unescape(title)) for cntnts_sn, title in _LIST_ITEM_PATTERN.findall(body)]


def _extract_summary(view_body: str) -> str | None:
    """상세 응답 HTML에서 섹션별 (제목, 본문 텍스트)을 뽑아 요약 후보를 고른다."""
    chunks = _SECTION_SPLIT_PATTERN.split(view_body)[1:]  # [0]은 섹션 시작 전 머리말
    sections: dict[str, str] = {}
    order: list[str] = []
    for chunk in chunks:
        heading_match = _H3_PATTERN.search(chunk)
        if not heading_match:
            continue
        title = _strip_html(heading_match.group(1))
        body_text = _strip_html(chunk[heading_match.end() :])
        if not title or not body_text:
            continue
        if title not in sections:
            order.append(title)
        sections[title] = body_text

    for preferred in _PREFERRED_SECTION_ORDER:
        if preferred in sections:
            return sections[preferred]
    if order:
        return sections[order[0]]
    return None


class KdcaHealthInfoClient:
    """질병관리청 국가건강정보포털 건강정보검색 API로 실시간 검색한다."""

    def __init__(self, fallback: HealthKnowledgeCatalogClient | None = None) -> None:
        self._fallback = fallback or HealthKnowledgeCatalogClient()

    async def search(self, query: str) -> HealthKnowledgeSearchResult:
        token = config.KDCA_HEALTH_INFO_API_KEY
        if not token:
            logger.debug("KDCA_HEALTH_INFO_API_KEY 미설정 — 수작업 카탈로그로 대체")
            logger.debug("[CHAT_TRACE] kdca executed=false fallback_used=true reason=no_token")
            return await self._fallback.search(query)

        try:
            items = await self._search_live(token, query)
            if not items:
                logger.debug("질병관리청 API 결과 없음 — 수작업 카탈로그 폴백")
                logger.debug("[CHAT_TRACE] kdca fallback_used=true reason=no_live_results")
                return await self._fallback.search(query)
        except Exception as ex:
            logger.warning("질병관리청 건강정보 API 호출 실패(%s) — 수작업 카탈로그로 대체", type(ex).__name__)
            logger.debug("[CHAT_TRACE] kdca fallback_used=true reason=exception")
            return await self._fallback.search(query)

        logger.debug("[CHAT_TRACE] kdca fallback_used=false item_count=%d", len(items))
        return HealthKnowledgeSearchResult(
            query=query,
            items=items,
            retrieved_at=datetime.now(_SEOUL),
            message=(
                f"질병관리청 국가건강정보포털에서 공식 문서 {len(items)}건을 확인했습니다."
                if items
                else "질병관리청 국가건강정보포털에서 관련 문서를 찾지 못했습니다."
            ),
        )

    async def _search_live(self, token: str, query: str) -> list[HealthKnowledgeItem]:
        candidates = _candidate_keywords(query)
        # candidates[0]은 사용자 원문 질문이다. 원문·원문 유래 검색어는 개발 환경에서만
        # 남기고, production DEBUG에서는 개수 등 안전한 메타데이터만 남긴다.
        if config.ENV != Env.PROD:
            logger.debug("[CHAT_TRACE] kdca candidates=%s", candidates)
        else:
            logger.debug("[CHAT_TRACE] kdca candidate_count=%d", len(candidates))
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            list_items: list[tuple[str, str]] = []
            matched_keyword: str | None = None
            matched_index: int | None = None
            for index, keyword in enumerate(candidates):
                list_resp = await client.post(
                    _LIST_URL,
                    data={"TOKEN": token, "srchWrd": keyword, "lclasSn": "", "pageIndex": "1"},
                )
                list_resp.raise_for_status()
                raw_items = _parse_list_items(list_resp.text)
                # 포털 검색이 질환명 하나만 겹쳐도 문서를 돌려주는 경우가 있다
                # ("당뇨에 좋은 음식" → "당뇨병 급성 합병증"). 관련 없는 결과는 근거로
                # 인정하지 않고, 이번 검색어가 전부 걸러지면 다음 후보 검색어로 넘어간다.
                relevant_items = [(sn, title) for sn, title in raw_items if _is_relevant(title, query)]
                # candidate별 단계 계측(개수만. 원문 유래 keyword는 위 candidates 로그로 이미
                # local/dev에서만 남으므로 여기선 순번+개수만). 필터는 위에서 한 번만 돈다.
                logger.debug(
                    "[CHAT_TRACE] kdca cand index=%d list_parsed=%d relevant_pass=%d relevant_drop=%d",
                    index,
                    len(raw_items),
                    len(relevant_items),
                    len(raw_items) - len(relevant_items),
                )
                if relevant_items:
                    list_items = relevant_items[:_MAX_ITEMS]
                    matched_keyword, matched_index = keyword, index
                    break
            # matched_keyword는 candidates 중 하나라 원문일 수 있다 — 개발 환경에서만.
            # matched_index(순번)는 안전한 메타데이터라 항상 남긴다.
            if config.ENV != Env.PROD:
                logger.debug(
                    "[CHAT_TRACE] kdca matched_keyword=%s matched_index=%s",
                    matched_keyword,
                    matched_index,
                )
            else:
                logger.debug("[CHAT_TRACE] kdca matched_index=%s", matched_index)

            items: list[HealthKnowledgeItem] = []
            view_http_error = 0
            view_empty_summary = 0
            for cntnts_sn, title in list_items:
                try:
                    view_resp = await client.post(_VIEW_URL, data={"TOKEN": token, "cntnts_sn": cntnts_sn})
                    view_resp.raise_for_status()
                except httpx.HTTPError:
                    logger.warning("질병관리청 건강정보 상세 조회 실패 (cntnts_sn=%s)", cntnts_sn)
                    view_http_error += 1
                    continue
                summary = _extract_summary(view_resp.text)
                if not summary:
                    view_empty_summary += 1
                    continue
                items.append(
                    HealthKnowledgeItem(
                        title=title,
                        url=f"{_VIEW_BASE_URL}?cntnts_sn={cntnts_sn}",
                        summary=summary[:_SUMMARY_MAX_CHARS],
                        topics=[query],
                    )
                )
            # 상세(view) 단계 탈락 분기별 개수.
            logger.debug(
                "[CHAT_TRACE] kdca view attempted=%d http_error=%d empty_summary=%d final=%d",
                len(list_items),
                view_http_error,
                view_empty_summary,
                len(items),
            )
            logger.debug("[CHAT_TRACE] kdca titles=%s", [item.title for item in items])
            return items
