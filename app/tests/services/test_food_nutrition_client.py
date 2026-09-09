"""식약처 식품영양성분 클라이언트 단위 테스트 (DB 불필요, httpx Mock)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import patch

import pytest
import pytest_asyncio

from app.dtos.food_nutrition import FoodNutritionItem
from app.services.food_nutrition_catalog import search_food_catalog
from app.services.food_nutrition_client import (
    FoodNutritionClient,
    _build_food_nutrition_summary,
    _extract_primary_food_name,
    _parse_cpnt_item,
    _parse_list_item,
)


@pytest_asyncio.fixture(loop_scope="session", autouse=True)
async def _override_session() -> AsyncIterator[None]:
    """식품영양성분 클라이언트 테스트는 DB 불필요하므로 상위 conftest의 DB 세션 오버라이드를 끈다."""
    yield


class TestExtractPrimaryFoodName:
    def test_extract_from_question(self) -> None:
        assert _extract_primary_food_name("라면 먹어도 될까?") == "라면"
        assert _extract_primary_food_name("짜장면 칼로리 얼마야?") == "짜장면"
        assert _extract_primary_food_name("김치찌개 나트륨 많아?") == "김치찌개"
        assert _extract_primary_food_name("바나나 당류 알려줘") == "바나나"

    def test_extract_from_compound(self) -> None:
        assert _extract_primary_food_name("삼겹살이랑 소주") == "삼겹살"
        assert _extract_primary_food_name("떡볶이, 순대") == "떡볶이"

    def test_clean_name(self) -> None:
        assert _extract_primary_food_name("신라면") == "신라면"


class TestParseFoodItems:
    def test_parse_cpnt_item(self) -> None:
        raw: dict[str, Any] = {
            "FOOD_NM_KR": "신라면",
            "SERVING_SIZE": "120g",
            "AMT_NUM1": "500",
            "AMT_NUM7": "82",
            "AMT_NUM3": "10",
            "AMT_NUM4": "15",
            "AMT_NUM8": "4",
            "AMT_NUM14": "1790",
            "MAKER_NAME": "농심",
        }
        item = _parse_cpnt_item(raw)
        assert item.food_name == "신라면"
        assert item.serving_size == "120g"
        assert item.calories_kcal == 500.0
        assert item.carbohydrate_g == 82.0
        assert item.sodium_mg == 1790.0
        assert item.maker_name == "농심"

    def test_parse_list_item(self) -> None:
        raw: dict[str, Any] = {
            "DESC_KOR": "짜장면",
            "SERVING_WT": "650",
            "NUTR_CONT1": "797",
            "NUTR_CONT2": "134",
            "NUTR_CONT3": "20",
            "NUTR_CONT4": "20",
            "NUTR_CONT5": "10.6",
            "NUTR_CONT6": "2392",
            "BSSH_NM": "중식당",
        }
        item = _parse_list_item(raw)
        assert item.food_name == "짜장면"
        assert item.serving_size == "650g"
        assert item.calories_kcal == 797.0
        assert item.sodium_mg == 2392.0


class TestFoodCatalog:
    def test_catalog_search(self) -> None:
        ramen = search_food_catalog("라면")
        assert len(ramen) > 0
        assert any("라면" in item.food_name for item in ramen)

    def test_catalog_not_found(self) -> None:
        result = search_food_catalog("우주먼지음식12345")
        assert result == []


class TestBuildSummary:
    def test_summary_with_high_sodium(self) -> None:
        item = FoodNutritionItem(
            food_name="짬뽕",
            serving_size="900g",
            calories_kcal=688.0,
            sodium_mg=3782.0,
            sugar_g=8.4,
        )
        summary = _build_food_nutrition_summary("짬뽕", [item])
        assert "[식품영양성분 정보: 짬뽕]" in summary
        assert "열량 688kcal" in summary
        assert "나트륨 3782mg" in summary
        assert "국물" in summary

    def test_summary_empty(self) -> None:
        summary = _build_food_nutrition_summary("미지의음식", [])
        assert "찾지 못했습니다" in summary


@pytest.mark.asyncio
class TestFoodNutritionClient:
    async def test_search_uses_catalog_fallback_when_api_fails(self) -> None:
        client = FoodNutritionClient()
        with patch("app.core.config.FOOD_NUTRITION_API_KEY", "mock-key"):
            with patch("httpx.AsyncClient.get", side_effect=Exception("API connection error")):
                res = await client.search_food_nutrition("신라면")
                assert res.query == "신라면"
                assert len(res.items) > 0
                assert res.items[0].food_name == "신라면"
                assert res.items[0].calories_kcal == 500.0

    async def test_search_uses_cached_result(self) -> None:
        client = FoodNutritionClient()
        res1 = await client.search_food_nutrition("바나나")
        res2 = await client.search_food_nutrition("바나나")
        assert res1 is res2
