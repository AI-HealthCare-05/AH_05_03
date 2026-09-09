"""기상청·AirKorea 데이터를 야외 건강 질문용으로 조합한다.

외부 API 원문이나 인증키는 응답·로그에 남기지 않는다. 이 결과는 날씨와
대기질의 사실만 제공하며, 운동 가능 여부 같은 의료적 판단은 봄이의 안전 지침이
포함된 최종 응답 단계에서만 한다.
"""

from __future__ import annotations

import asyncio
import math
import re
import time
import urllib.parse
from datetime import datetime, timedelta
from typing import Any, Protocol
from zoneinfo import ZoneInfo

import httpx

from app.core import config
from app.core.utils.public_data import extract_public_data_items
from app.dtos.outdoor_conditions import AirQualityConditions, OutdoorConditionsResult, WeatherConditions


class OutdoorConditionsClientProtocol(Protocol):
    async def get_outdoor_conditions(self, latitude: float, longitude: float) -> OutdoorConditionsResult: ...

    async def resolve_location(self, text: str) -> tuple[float, float, str] | None: ...


_TIMEOUT_SECONDS = 5.0
_CACHE_SECONDS = 600.0
_SEOUL_TZ = ZoneInfo("Asia/Seoul")
_KMA_ULTRA_SHORT_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst"
_AIRKOREA_REALTIME_URL = "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty"
_KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
_KAKAO_REGION_URL = "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json"

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
_LOCATION_TOKEN_PATTERN = re.compile(r"[가-힣A-Za-z0-9·]{2,30}(?:역|숲|공원|산|해변|해수욕장|구|시|군|동|읍|면)")

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
_SIDO_ALIASES = {
    "서울": ("서울특별시", "서울시", "서울"),
    "부산": ("부산광역시", "부산시", "부산"),
    "대구": ("대구광역시", "대구시", "대구"),
    "인천": ("인천광역시", "인천시", "인천"),
    "광주": ("광주광역시", "광주시", "광주"),
    "대전": ("대전광역시", "대전시", "대전"),
    "울산": ("울산광역시", "울산시", "울산"),
    "세종": ("세종특별자치시", "세종시", "세종"),
    "경기": ("경기도", "경기"),
    "강원": ("강원특별자치도", "강원도", "강원"),
    "충북": ("충청북도", "충북"),
    "충남": ("충청남도", "충남"),
    "전북": ("전북특별자치도", "전라북도", "전북"),
    "전남": ("전라남도", "전남"),
    "경북": ("경상북도", "경북"),
    "경남": ("경상남도", "경남"),
    "제주": ("제주특별자치도", "제주도", "제주"),
}


def resolve_sido_coordinates(text: str) -> tuple[str, float, float] | None:
    """텍스트에서 시도 명칭을 감지하여 대표 좌표(위도, 경도)를 반환한다."""
    for sido, aliases in _SIDO_ALIASES.items():
        for alias in aliases:
            if re.search(rf"(?<![가-힣]){re.escape(alias)}(?![가-힣])", text):
                lat, lon = _SIDO_CENTERS[sido]
                return sido, lat, lon
        short_name = aliases[-1]
        if re.search(rf"{re.escape(short_name)}(?=날씨|미세먼지|초미세먼지|대기질|살아|살아요)", text):
            lat, lon = _SIDO_CENTERS[sido]
            return sido, lat, lon
    return None


class OutdoorConditionsClient:
    """현재 좌표의 날씨와 권역 대기질을 동시에 조회한다."""

    def __init__(
        self,
        kma_api_key: str | None = None,
        airkorea_api_key: str | None = None,
        kakao_api_key: str | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.kma_api_key = self._clean_key(kma_api_key if kma_api_key is not None else config.KMA_API_KEY)
        self.airkorea_api_key = self._clean_key(
            airkorea_api_key if airkorea_api_key is not None else config.AIRKOREA_API_KEY
        )
        self.kakao_api_key = self._clean_key(kakao_api_key if kakao_api_key is not None else config.KAKAO_REST_API_KEY)
        self._http_client = http_client
        self._cache: dict[tuple[float, float], tuple[float, OutdoorConditionsResult]] = {}

    @staticmethod
    def _clean_key(key: str | None) -> str | None:
        return urllib.parse.unquote(key.strip()) if key else None

    def _get_client(self) -> httpx.AsyncClient:
        return self._http_client or httpx.AsyncClient(timeout=_TIMEOUT_SECONDS)

    async def resolve_location(self, text: str) -> tuple[float, float, str] | None:
        """건강 문장 전체가 아닌 장소 토큰만 카카오 로컬 검색으로 좌표화한다."""
        if not self.kakao_api_key:
            return None
        queries = list(dict.fromkeys(_LOCATION_TOKEN_PATTERN.findall(text)))
        if not queries:
            return None

        client = self._get_client()
        try:
            for query in reversed(queries):
                try:
                    response = await client.get(
                        _KAKAO_KEYWORD_URL,
                        params={"query": query, "size": "1"},
                        headers={"Authorization": f"KakaoAK {self.kakao_api_key}"},
                    )
                    if response.status_code != 200:
                        continue
                    documents = response.json().get("documents", [])
                    if not documents:
                        continue
                    document = documents[0]
                    return float(document["y"]), float(document["x"]), str(document.get("place_name") or query)
                except (httpx.HTTPError, KeyError, TypeError, ValueError):
                    continue
            return None
        finally:
            if self._http_client is None:
                await client.aclose()

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
            # 관측이 아직 안 올라온 시각에는 items 가 빈 문자열로 온다. 봉투를 직접
            # 이어 붙이면 거기서 AttributeError 가 나는데, 아래 except 가 안 잡는 종류라
            # 날씨 조회만 실패하는 게 아니라 채팅 요청 전체가 깨진다.
            items = extract_public_data_items(response.json())
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
        try:
            region_name, district_names = await self._resolve_air_quality_area(client, latitude, longitude)
            region_items = await self._fetch_region_air_quality_items(client, region_name)
            item = next(
                (
                    candidate
                    for candidate in region_items
                    if self._station_matches_district(candidate, district_names)
                    and self._has_air_quality_value(candidate)
                ),
                None,
            )
            if item is None:
                item = next((candidate for candidate in region_items if self._has_air_quality_value(candidate)), None)
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

    async def _fetch_region_air_quality_items(
        self, client: httpx.AsyncClient, region_name: str
    ) -> list[dict[str, Any]]:
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
            raise httpx.HTTPStatusError("AirKorea region lookup failed", request=response.request, response=response)
        # 에어코리아는 items 가 바로 목록이다. 0건일 때의 빈 문자열은 공용 함수가 받는다.
        return extract_public_data_items(response.json())

    async def _resolve_air_quality_area(
        self,
        client: httpx.AsyncClient,
        latitude: float,
        longitude: float,
    ) -> tuple[str, tuple[str, ...]]:
        fallback_region = self._resolve_sido(latitude, longitude)
        if not self.kakao_api_key:
            return fallback_region, ()
        try:
            response = await client.get(
                _KAKAO_REGION_URL,
                params={"x": str(longitude), "y": str(latitude)},
                headers={"Authorization": f"KakaoAK {self.kakao_api_key}"},
            )
            if response.status_code != 200:
                return fallback_region, ()
            documents = response.json().get("documents", [])
            if not documents:
                return fallback_region, ()
            document = next(
                (candidate for candidate in documents if candidate.get("region_type") == "H"),
                documents[0],
            )
            region_1depth = str(document.get("region_1depth_name") or "")
            region_name = next(
                (sido for sido, aliases in _SIDO_ALIASES.items() if any(alias in region_1depth for alias in aliases)),
                fallback_region,
            )
            district_names = tuple(
                name
                for name in (
                    str(document.get("region_2depth_name") or ""),
                    str(document.get("region_3depth_name") or ""),
                )
                if name
            )
            return region_name, district_names
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            return fallback_region, ()

    @staticmethod
    def _station_matches_district(item: dict[str, Any], district_names: tuple[str, ...]) -> bool:
        station_name = str(item.get("stationName") or "")
        return bool(station_name and any(station_name == name or station_name in name for name in district_names))

    @staticmethod
    def _has_air_quality_value(item: dict[str, Any]) -> bool:
        return item.get("pm10Value") not in (None, "-") or item.get("pm25Value") not in (None, "-")

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
