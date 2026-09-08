from __future__ import annotations

import httpx
import pytest

from app.services.outdoor_conditions_client import OutdoorConditionsClient
from app.services.outdoor_conditions_tools import execute_outdoor_conditions_tool


def test_to_kma_grid_for_seoul_city_hall() -> None:
    assert OutdoorConditionsClient.to_kma_grid(37.5665, 126.9780) == (60, 127)


@pytest.mark.asyncio
async def test_get_outdoor_conditions_combines_weather_and_air_quality() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "VilageFcstInfoService" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "response": {
                        "body": {
                            "items": {
                                "item": [
                                    {"category": "T1H", "obsrValue": "23.4"},
                                    {"category": "REH", "obsrValue": "55"},
                                    {"category": "PTY", "obsrValue": "0"},
                                    {"category": "RN1", "obsrValue": "0"},
                                    {"category": "WSD", "obsrValue": "1.2"},
                                ]
                            }
                        }
                    }
                },
            )
        if "ArpltnInforInqireSvc" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "response": {
                        "body": {
                            "items": [
                                {
                                    "stationName": "중구",
                                    "pm10Value": "24",
                                    "pm25Value": "11",
                                    "pm10Grade": "1",
                                    "pm25Grade": "2",
                                }
                            ]
                        }
                    }
                },
            )
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = OutdoorConditionsClient(
            kma_api_key="test-key",
            airkorea_api_key="test-key",
            http_client=http_client,
        )
        result = await client.get_outdoor_conditions(37.5665, 126.9780)

    assert result.weather is not None
    assert result.weather.temperature_c == 23.4
    assert result.weather.precipitation_type == "강수 없음"
    assert result.air_quality is not None
    assert result.air_quality.region_name == "서울"
    assert result.air_quality.pm10 == 24
    assert result.air_quality.pm25_grade == "보통"
    assert result.errors == []


@pytest.mark.asyncio
async def test_outdoor_tool_requires_coordinates() -> None:
    client = OutdoorConditionsClient(kma_api_key="test-key", airkorea_api_key="test-key")
    result = await execute_outdoor_conditions_tool("get_outdoor_health_conditions", {}, client)
    assert result is None
