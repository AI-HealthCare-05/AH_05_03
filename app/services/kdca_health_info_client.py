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
_TRAILING_PARTICLE_PATTERN = re.compile(r"(?<=[가-힣]{2})(은|는|이|가|을|를|도|만|에|의|로|으로)$")
_MAX_KEYWORD_ATTEMPTS = 4


def _candidate_keywords(query: str) -> list[str]:
    """포털 검색어 후보를 만든다. 원문 통째로 → 조사 뗀 단어들 순으로 시도한다.

    이 검색은 제목에 대한 단순 매칭이라 "당뇨에 좋은 음식 뭐가 있어" 같은
    문장 전체로는 안 걸리고 "당뇨"처럼 짧은 명사라야 걸린다.
    """
    candidates = [query]
    for token in _TOKEN_SPLIT_PATTERN.split(query):
        stripped = _TRAILING_PARTICLE_PATTERN.sub("", token)
        if len(stripped) >= 2 and stripped not in candidates:
            candidates.append(stripped)
    return candidates[:_MAX_KEYWORD_ATTEMPTS]


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
            return await self._fallback.search(query)

        try:
            items = await self._search_live(token, query)
            if not items:
                logger.debug("질병관리청 API 결과 없음 — 수작업 카탈로그 폴백")
                return await self._fallback.search(query)
        except Exception as ex:
            logger.warning("질병관리청 건강정보 API 호출 실패(%s) — 수작업 카탈로그로 대체", type(ex).__name__)
            return await self._fallback.search(query)

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
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            list_items: list[tuple[str, str]] = []
            for keyword in _candidate_keywords(query):
                list_resp = await client.post(
                    _LIST_URL,
                    data={"TOKEN": token, "srchWrd": keyword, "lclasSn": "", "pageIndex": "1"},
                )
                list_resp.raise_for_status()
                list_items = _parse_list_items(list_resp.text)[:_MAX_ITEMS]
                if list_items:
                    break

            items: list[HealthKnowledgeItem] = []
            for cntnts_sn, title in list_items:
                try:
                    view_resp = await client.post(_VIEW_URL, data={"TOKEN": token, "cntnts_sn": cntnts_sn})
                    view_resp.raise_for_status()
                except httpx.HTTPError:
                    logger.warning("질병관리청 건강정보 상세 조회 실패 (cntnts_sn=%s)", cntnts_sn)
                    continue
                summary = _extract_summary(view_resp.text)
                if not summary:
                    continue
                items.append(
                    HealthKnowledgeItem(
                        title=title,
                        url=f"{_VIEW_BASE_URL}?cntnts_sn={cntnts_sn}",
                        summary=summary[:_SUMMARY_MAX_CHARS],
                        topics=[query],
                    )
                )
            return items
