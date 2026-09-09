"""식약처 의약품 클라이언트 단위 테스트 (DB 불필요, httpx Mock)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

from app.dtos.medication import DrugInfo, DurItem, MedicationSearchResult
from app.services.medication_client import (
    MedicationClient,
    _build_summary_message,
    _parse_dur_items,
    _parse_easydr_item,
)


@pytest_asyncio.fixture(loop_scope="session", autouse=True)
async def _override_session() -> AsyncIterator[None]:
    """식약처 클라이언트 단위 테스트는 DB 불필요하므로 상위 conftest의 DB 세션 오버라이드를 끈다."""
    yield


# ---------------------------------------------------------------------------
# 파싱 헬퍼 단위 테스트
# ---------------------------------------------------------------------------


class TestParseEasydrItem:
    def test_full_fields(self) -> None:
        raw = {
            "itemName": "타이레놀정500밀리그람",
            "entpName": "한국얀센",
            "className": "해열·진통·소염제",
            "efcyQesitm": "두통, 치통에 효과적입니다.",
            "useMethodQesitm": "1일 3회 복용",
            "atpnWarnQesitm": "과량 복용 금지",
            "atpnQesitm": "간 질환자 주의",
            "intrcQesitm": "알코올과 병용 주의",
            "seQesitm": "구역, 구토",
            "depositMethodQesitm": "실온 보관",
        }
        item = _parse_easydr_item(raw)
        assert item.item_name == "타이레놀정500밀리그람"
        assert item.entp_name == "한국얀센"
        assert item.class_name == "해열·진통·소염제"
        assert item.efcy_qesitm == "두통, 치통에 효과적입니다."
        assert item.se_qesitm == "구역, 구토"

    def test_minimal_fields(self) -> None:
        raw = {"itemName": "테스트정"}
        item = _parse_easydr_item(raw)
        assert item.item_name == "테스트정"
        assert item.entp_name is None
        assert item.efcy_qesitm is None


class TestParseDurItems:
    def test_parse_prohibition_items(self) -> None:
        raw_list: list[dict[str, Any]] = [
            {
                "prohibitContent": "병용금기",
                "ingdIngdNm": "와파린",
                "prhibtContent": "출혈 위험 증가",
            },
            {
                "typeNm": "임부금기",
                "mixture": None,
                "remark": "태아 독성",
            },
        ]
        items = _parse_dur_items(raw_list)
        assert len(items) == 2
        assert items[0].prohibition_type == "병용금기"
        assert items[0].ingredient_name == "와파린"
        assert items[0].reason == "출혈 위험 증가"
        assert items[1].prohibition_type == "임부금기"

    def test_empty_list(self) -> None:
        assert _parse_dur_items([]) == []


class TestBuildSummaryMessage:
    def test_no_items_returns_not_found(self) -> None:
        msg = _build_summary_message("없는약", [])
        assert "찾지 못했습니다" in msg

    def test_with_item_includes_name(self) -> None:
        drug = DrugInfo(
            item_name="타이레놀정500밀리그람",
            efcy_qesitm="두통에 효과적",
            use_method_qesitm="1일 3회",
        )
        msg = _build_summary_message("타이레놀", [drug])
        assert "타이레놀정500밀리그람" in msg
        assert "효능·효과" in msg

    def test_with_dur_items(self) -> None:
        drug = DrugInfo(
            item_name="아스피린정100밀리그람",
            dur_items=[DurItem(prohibition_type="병용금기", ingredient_name="와파린", reason="출혈 위험")],
        )
        msg = _build_summary_message("아스피린", [drug])
        assert "DUR 주의·금기" in msg
        assert "와파린" in msg


class TestNeedsMedicationInfoRouting:
    def test_medication_recording_statement_returns_false(self) -> None:
        from app.dtos.health_assistant import ChatMessage, HealthAssistantChatRequest
        from app.services.health_assistant import HealthAssistantService

        req = HealthAssistantChatRequest(
            messages=[ChatMessage(role="user", content="저녁 8시에 타이레놀 1알 복용했어")]
        )
        assert HealthAssistantService._needs_medication_info(req) is False

    def test_medication_question_returns_true(self) -> None:
        from app.dtos.health_assistant import ChatMessage, HealthAssistantChatRequest
        from app.services.health_assistant import HealthAssistantService

        req = HealthAssistantChatRequest(messages=[ChatMessage(role="user", content="타이레놀이 어떤 약이야?")])
        assert HealthAssistantService._needs_medication_info(req) is True

    def test_interaction_question_returns_true(self) -> None:
        from app.dtos.health_assistant import ChatMessage, HealthAssistantChatRequest
        from app.services.health_assistant import HealthAssistantService

        req = HealthAssistantChatRequest(
            messages=[ChatMessage(role="user", content="타이레놀이랑 판콜 같이 먹어도 돼?")]
        )
        assert HealthAssistantService._needs_medication_info(req) is True


# ---------------------------------------------------------------------------
# MedicationClient 통합 (httpx Mock)
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_easydr_response() -> dict:
    return {
        "body": {
            "items": [
                {
                    "itemName": "타이레놀정500밀리그람",
                    "entpName": "한국얀센",
                    "className": "해열·진통·소염제",
                    "efcyQesitm": "두통, 치통, 발열에 효과적입니다.",
                    "useMethodQesitm": "1일 3~4회 복용",
                    "atpnQesitm": "간 기능 장애 환자는 주의",
                    "seQesitm": "드물게 피부 발진",
                }
            ]
        }
    }


@pytest.fixture
def mock_dur_response() -> dict:
    return {
        "body": {
            "items": [
                {
                    "prohibitContent": "병용금기",
                    "ingdIngdNm": "와파린",
                    "prhibtContent": "출혈 위험 증가",
                }
            ]
        }
    }


@pytest.mark.asyncio
async def test_search_medication_no_api_key() -> None:
    """MFDS_API_KEY 없으면 빈 결과 반환, 예외 없음."""
    with patch("app.services.medication_client.config") as mock_cfg:
        mock_cfg.MFDS_API_KEY = None
        client = MedicationClient()
        result = await client.search_medication("타이레놀")
    assert isinstance(result, MedicationSearchResult)
    assert result.items == []
    assert result.query == "타이레놀"


@pytest.mark.asyncio
async def test_search_medication_success(
    mock_easydr_response: dict,
    mock_dur_response: dict,
) -> None:
    """정상 응답 시 DrugInfo와 DurItem이 채워진다."""
    mock_resp_easydr = MagicMock()
    mock_resp_easydr.raise_for_status = MagicMock()
    mock_resp_easydr.json.return_value = mock_easydr_response

    mock_resp_dur = MagicMock()
    mock_resp_dur.raise_for_status = MagicMock()
    mock_resp_dur.json.return_value = mock_dur_response

    call_count = 0

    async def fake_get(url: str, **kwargs):  # noqa: ANN001
        nonlocal call_count
        call_count += 1
        if "DrbEasyDrugInfoService" in url:
            return mock_resp_easydr
        return mock_resp_dur

    with patch("app.services.medication_client.config") as mock_cfg:
        mock_cfg.MFDS_API_KEY = "test-api-key"
        with patch("httpx.AsyncClient") as mock_http:
            mock_http.return_value.__aenter__ = AsyncMock(return_value=MagicMock(get=AsyncMock(side_effect=fake_get)))
            mock_http.return_value.__aexit__ = AsyncMock(return_value=False)
            client = MedicationClient()
            # 캐시 초기화
            from app.services import medication_client as mc_mod

            mc_mod._cache.clear()
            result = await client.search_medication("타이레놀")

    assert len(result.items) == 1
    assert result.items[0].item_name == "타이레놀정500밀리그람"
    assert len(result.items[0].dur_items) == 1
    assert result.items[0].dur_items[0].ingredient_name == "와파린"
    assert "타이레놀정500밀리그람" in result.message


@pytest.mark.asyncio
async def test_search_medication_api_error() -> None:
    """외부 API 오류 시 errors에 기록되고 빈 items 반환."""
    with patch("app.services.medication_client.config") as mock_cfg:
        mock_cfg.MFDS_API_KEY = "test-api-key"
        with patch("httpx.AsyncClient") as mock_http:
            mock_client = MagicMock()
            mock_client.get = AsyncMock(side_effect=Exception("연결 실패"))
            mock_http.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_http.return_value.__aexit__ = AsyncMock(return_value=False)
            client = MedicationClient()
            from app.services import medication_client as mc_mod

            mc_mod._cache.clear()
            result = await client.search_medication("타이레놀")

    assert result.items == []
    assert len(result.errors) > 0


@pytest.mark.asyncio
async def test_search_medication_cache(mock_easydr_response: dict, mock_dur_response: dict) -> None:
    """같은 질의는 두 번째부터 캐시에서 반환된다."""
    call_count = 0

    async def fake_get(url: str, **kwargs):  # noqa: ANN001
        nonlocal call_count
        call_count += 1
        mock_r = MagicMock()
        mock_r.raise_for_status = MagicMock()
        mock_r.json.return_value = mock_easydr_response if "DrbEasyDrugInfoService" in url else mock_dur_response
        return mock_r

    with patch("app.services.medication_client.config") as mock_cfg:
        mock_cfg.MFDS_API_KEY = "test-key"
        with patch("httpx.AsyncClient") as mock_http:
            mock_http.return_value.__aenter__ = AsyncMock(return_value=MagicMock(get=AsyncMock(side_effect=fake_get)))
            mock_http.return_value.__aexit__ = AsyncMock(return_value=False)
            client = MedicationClient()
            from app.services import medication_client as mc_mod

            mc_mod._cache.clear()
            await client.search_medication("아스피린")
            first_count = call_count
            await client.search_medication("아스피린")  # 캐시 히트
            assert call_count == first_count  # 추가 호출 없음


@pytest.mark.asyncio
async def test_search_medication_masks_api_key_in_logs(caplog: pytest.LogCaptureFixture) -> None:
    """API 오류 발생 시 로그에 인증키가 노출되지 않고 마스킹된다."""
    real_secret_key = "SECRET_API_KEY_12345"

    with patch("app.services.medication_client.config") as mock_cfg:
        mock_cfg.MFDS_API_KEY = real_secret_key
        with patch("httpx.AsyncClient") as mock_http:
            mock_client = MagicMock()
            # httpx 오류처럼 URL과 serviceKey가 포함된 예외 발생
            mock_client.get = AsyncMock(
                side_effect=Exception(
                    f"403 Forbidden for url 'https://apis.data.go.kr/...?serviceKey={real_secret_key}&itemName=test'"
                )
            )
            mock_http.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_http.return_value.__aexit__ = AsyncMock(return_value=False)

            client = MedicationClient()
            from app.services import medication_client as mc_mod

            mc_mod._cache.clear()
            with caplog.at_level("WARNING"):
                result = await client.search_medication("타이레놀")

    assert result.items == []
    # 로그에 실제 시크릿 키가 절대 포함되지 않아야 함
    assert real_secret_key not in caplog.text
    # 마스킹 표시가 포함되어야 함
    assert "serviceKey=***" in caplog.text
