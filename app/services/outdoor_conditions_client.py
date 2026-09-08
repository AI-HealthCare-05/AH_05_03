"""기상청·AirKorea 데이터를 야외 건강 질문용으로 조합한다.

외부 API 원문이나 인증키는 응답·로그에 남기지 않는다. 이 결과는 날씨와
대기질의 사실만 제공하며, 운동 가능 여부 같은 의료적 판단은 봄이의 안전 지침이
포함된 최종 응답 단계에서만 한다.
"""

from __future__ import annotations

import asyncio
import math
import time
import urllib.parse
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from app.core import config
from app.dtos.outdoor_conditions import AirQualityConditions, OutdoorConditionsResult, WeatherConditions

_TIMEOUT_SECONDS = 5.0
_CACHE_SECONDS = 600.0
_SEOUL_TZ = ZoneInfo("Asia/Seoul")
_KMA_ULTRA_SHORT_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst"
_AIRKOREA_REALTIME_URL = "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty"

# 기상청 단기예보용 DFS 격자 상수.
_RE = 6371.00877
_GRID = 5.0
_SLAT1 = 30.0
_SLAT2 = 60.0
_OLON = 126.0
_OLAT = 38.0
_XO = 43
_YO = 136

_PRECIPITATION_TYPES = {
    "0": "강수 없음",
    "1": "비",
    "2": "비/눈",
    "3": "눈",
    "5": "빗방울",
    "6": "빗방울/눈날림",
    "7": "눈날림",
}
_AIR_GRADES = {"1": "좋음", "2": "보통", "3": "나쁨", "4": "매우 나쁨"}

# AirKorea 시도별 실시간 조회를 위한 권역 중심점. 측정소는 API 응답에서 함께 받는다.
_SIDO_CENTERS = {
    "서울": (37.5665, 126.9780),
    "부산": (35.1796, 129.0756),
    "대구": (35.8714, 128.6014),
    "인천": (37.4563, 126.7052),
    "광주": (35.1595, 126.8526),
    "대전": (36.3504, 127.3845),
    "울산": (35.5384, 129.3114),
    "세종": (36.4800, 127.2890),
    "경기": (37.4138, 127.5183),
    "강원": (37.8228, 128.1555),
    "충북": (36.6357, 127.4917),
    "충남": (36.6588, 126.6728),
    "전북": (35.8200, 127.1088),
    "전남": (34.8679, 126.9910),
    "경북": (36.4919, 128.8889),
    "경남": (35.4606, 128.2132),
    "제주": (33.4890, 126.4983),
}


class OutdoorConditionsClient:
    """현재 좌표의 날씨와 권역 대기질을 동시에 조회한다."""

    def __init__(
        self,
        kma_api_key: str | None = None,
        airkorea_api_key: str | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.kma_api_key = self._clean_key(kma_api_key if kma_api_key is not None else config.KMA_API_KEY)
        self.airkorea_api_key = self._clean_key(
            airkorea_api_key if airkorea_api_key is not None else config.AIRKOREA_API_KEY
        )
        self._http_client = http_client
        self._cache: dict[tuple[float, float], tuple[float, OutdoorConditionsResult]] = {}

    @staticmethod
    def _clean_key(key: str | None) -> str | None:
        return urllib.parse.unquote(key.strip()) if key else None

    def _get_client(self) -> httpx.AsyncClient:
        return self._http_client or httpx.AsyncClient(timeout=_TIMEOUT_SECONDS)

    @staticmethod
    def to_kma_grid(latitude: float, longitude: float) -> tuple[int, int]:
        """WGS84 위경도를 기상청 DFS 격자로 변환한다."""
        re = _RE / _GRID
        slat1 = math.radians(_SLAT1)
        slat2 = math.radians(_SLAT2)
        olon = math.radians(_OLON)
        olat = math.radians(_OLAT)
        sn = math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5)
        sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(sn)
        sf = math.tan(math.pi * 0.25 + slat1 * 0.5) ** sn * math.cos(slat1) / sn
        ro = re * sf / math.tan(math.pi * 0.25 + olat * 0.5) ** sn
        ra = re * sf / math.tan(math.pi * 0.25 + math.radians(latitude) * 0.5) ** sn
        theta = math.radians(longitude) - olon
        if theta > math.pi:
            theta -= 2.0 * math.pi
        elif theta < -math.pi:
            theta += 2.0 * math.pi
        theta *= sn
        return int(math.floor(ra * math.sin(theta) + _XO + 0.5)), int(math.floor(ro - ra * math.cos(theta) + _YO + 0.5))

    @staticmethod
    def _latest_kma_base(now: datetime | None = None) -> tuple[str, str]:
        current = (now or datetime.now(_SEOUL_TZ)).astimezone(_SEOUL_TZ) - timedelta(minutes=40)
        return current.strftime("%Y%m%d"), current.strftime("%H00")

    @staticmethod
    def _resolve_sido(latitude: float, longitude: float) -> str:
        return min(
            _SIDO_CENTERS,
            key=lambda name: (latitude - _SIDO_CENTERS[name][0]) ** 2 + (longitude - _SIDO_CENTERS[name][1]) ** 2,
        )

    async def get_outdoor_conditions(self, latitude: float, longitude: float) -> OutdoorConditionsResult:
        cache_key = (round(latitude, 2), round(longitude, 2))
        cached = self._cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < _CACHE_SECONDS:
            return cached[1].model_copy(deep=True)

        client = self._get_client()
        try:
            (weather, weather_error), (air_quality, air_error) = await asyncio.gather(
                self._fetch_weather(client, latitude, longitude),
                self._fetch_air_quality(client, latitude, longitude),
            )
            errors = [error for error in (weather_error, air_error) if error]
            result = OutdoorConditionsResult(
                latitude=latitude,
                longitude=longitude,
                weather=weather,
                air_quality=air_quality,
                errors=errors,
            )
            self._cache[cache_key] = (time.monotonic(), result)
            return result
        finally:
            if self._http_client is None:
                await client.aclose()

    async def _fetch_weather(
        self,
        client: httpx.AsyncClient,
        latitude: float,
        longitude: float,
    ) -> tuple[WeatherConditions | None, str | None]:
        if not self.kma_api_key:
            return None, "기상청 API 키가 설정되지 않았습니다."
        nx, ny = self.to_kma_grid(latitude, longitude)
        base_date, base_time = self._latest_kma_base()
        try:
            response = await client.get(
                _KMA_ULTRA_SHORT_URL,
                params={
                    "serviceKey": self.kma_api_key,
                    "pageNo": "1",
                    "numOfRows": "60",
                    "dataType": "JSON",
                    "base_date": base_date,
                    "base_time": base_time,
                    "nx": str(nx),
                    "ny": str(ny),
                },
            )
            if response.status_code != 200:
                return None, "기상청 날씨 정보를 불러오지 못했습니다."
            items = response.json().get("response", {}).get("body", {}).get("items", {}).get("item", [])
            categories = {item.get("category"): item.get("obsrValue") for item in items}
            if not categories:
                return None, "기상청 날씨 정보가 아직 준비되지 않았습니다."
            return (
                WeatherConditions(
                    temperature_c=self._as_float(categories.get("T1H")),
                    humidity_percent=self._as_int(categories.get("REH")),
                    precipitation_type=_PRECIPITATION_TYPES.get(str(categories.get("PTY", "0")), "확인 불가"),
                    precipitation_mm=self._as_float(categories.get("RN1")),
                    wind_speed_mps=self._as_float(categories.get("WSD")),
                ),
                None,
            )
        except (httpx.HTTPError, ValueError, TypeError):
            return None, "기상청 날씨 정보를 불러오지 못했습니다."

    async def _fetch_air_quality(
        self,
        client: httpx.AsyncClient,
        latitude: float,
        longitude: float,
    ) -> tuple[AirQualityConditions | None, str | None]:
        if not self.airkorea_api_key:
            return None, "AirKorea API 키가 설정되지 않았습니다."
        region_name = self._resolve_sido(latitude, longitude)
        try:
            response = await client.get(
                _AIRKOREA_REALTIME_URL,
                params={
                    "serviceKey": self.airkorea_api_key,
                    "returnType": "json",
                    "numOfRows": "100",
                    "pageNo": "1",
                    "sidoName": region_name,
                    "ver": "1.4",
                },
            )
            if response.status_code != 200:
                return None, "AirKorea 대기질 정보를 불러오지 못했습니다."
            items = response.json().get("response", {}).get("body", {}).get("items", [])
            item = next((candidate for candidate in items if candidate.get("pm10Value") not in (None, "-")), None)
            if item is None:
                return None, "AirKorea 대기질 정보가 아직 준비되지 않았습니다."
            return (
                AirQualityConditions(
                    region_name=region_name,
                    station_name=item.get("stationName"),
                    pm10=self._as_int(item.get("pm10Value")),
                    pm25=self._as_int(item.get("pm25Value")),
                    pm10_grade=_AIR_GRADES.get(str(item.get("pm10Grade"))),
                    pm25_grade=_AIR_GRADES.get(str(item.get("pm25Grade"))),
                ),
                None,
            )
        except (httpx.HTTPError, ValueError, TypeError):
            return None, "AirKorea 대기질 정보를 불러오지 못했습니다."

    @staticmethod
    def _as_float(value: Any) -> float | None:
        try:
            return float(value) if value not in (None, "-", "강수없음") else None
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _as_int(value: Any) -> int | None:
        try:
            return int(float(value)) if value not in (None, "-") else None
        except (TypeError, ValueError):
            return None
