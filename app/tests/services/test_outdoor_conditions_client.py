from __future__ import annotations

import httpx
import pytest

from app.services.outdoor_conditions_client import OutdoorConditionsClient, resolve_sido_coordinates
from app.services.outdoor_conditions_tools import execute_outdoor_conditions_tool


def test_to_kma_grid_for_seoul_city_hall() -> None:
    assert OutdoorConditionsClient.to_kma_grid(37.5665, 126.9780) == (60, 127)


def test_resolve_sido_does_not_treat_place_name_as_whole_region() -> None:
    assert resolve_sido_coordinates("오늘 서울 날씨 어때") == ("서울", 37.5665, 126.978)
    assert resolve_sido_coordinates("난 서울살아") == ("서울", 37.5665, 126.978)
    assert resolve_sido_coordinates("서울숲에서 러닝할 거야") is None
    assert resolve_sido_coordinates("부산역 날씨 알려줘") is None


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
        if "coord2regioncode" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "documents": [
                        {
                            "region_type": "H",
                            "region_1depth_name": "서울특별시",
                            "region_2depth_name": "강남구",
                            "region_3depth_name": "역삼1동",
                        }
                    ]
                },
            )
        if "getCtprvnRltmMesureDnsty" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "response": {
                        "body": {
                            "items": [
                                {
                                    "stationName": "중구",
                                    "pm10Value": "44",
                                    "pm25Value": "21",
                                    "pm10Grade": "2",
                                    "pm25Grade": "2",
                                },
                                {
                                    "stationName": "강남구",
                                    "pm10Value": "24",
                                    "pm25Value": "11",
                                    "pm10Grade": "1",
                                    "pm25Grade": "2",
                                },
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
            kakao_api_key="test-key",
            http_client=http_client,
        )
        result = await client.get_outdoor_conditions(37.5665, 126.9780)

    assert result.weather is not None
    assert result.weather.temperature_c == 23.4
    assert result.weather.precipitation_type == "강수 없음"
    assert result.air_quality is not None
    assert result.air_quality.region_name == "서울"
    assert result.air_quality.station_name == "강남구"
    assert result.air_quality.pm10 == 24
    assert result.air_quality.pm25_grade == "보통"
    assert result.errors == []


@pytest.mark.asyncio
async def test_empty_public_data_payload_degrades_instead_of_crashing() -> None:
    """0건일 때 오는 `items: ""` 가 요청 전체를 깨뜨리면 안 된다.

    봉투를 직접 이어 붙이면 빈 문자열에 `.get` 을 불러 AttributeError 가 나는데,
    이 함수의 except 는 그 종류를 잡지 않는다. 그래서 관측이 아직 안 올라온 시각에
    날씨만 비는 게 아니라 채팅 요청 자체가 500 으로 떨어졌다.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if "coord2regioncode" in str(request.url):
            return httpx.Response(200, json={"documents": []})
        return httpx.Response(200, json={"response": {"body": {"items": ""}}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = OutdoorConditionsClient(
            kma_api_key="test-key",
            airkorea_api_key="test-key",
            kakao_api_key="test-key",
            http_client=http_client,
        )
        result = await client.get_outdoor_conditions(37.5665, 126.9780)

    assert result.weather is None
    assert result.air_quality is None
    assert result.errors  # 조용히 성공한 척하지 않고 사유를 남긴다.


@pytest.mark.asyncio
async def test_outdoor_tool_requires_coordinates() -> None:
    client = OutdoorConditionsClient(kma_api_key="test-key", airkorea_api_key="test-key")
    result = await execute_outdoor_conditions_tool("get_outdoor_health_conditions", {}, client)
    assert result is None


@pytest.mark.asyncio
async def test_resolve_location_sends_only_place_token_to_kakao() -> None:
    requested_queries: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_queries.append(request.url.params["query"])
        return httpx.Response(
            200,
            json={
                "documents": [
                    {
                        "place_name": "양재시민의숲",
                        "x": "127.0350",
                        "y": "37.4700",
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = OutdoorConditionsClient(kakao_api_key="test-key", http_client=http_client)
        result = await client.resolve_location("오늘 양재숲에서 러닝할 거야")

    assert result == (37.47, 127.035, "양재시민의숲")
    assert requested_queries == ["양재숲"]
