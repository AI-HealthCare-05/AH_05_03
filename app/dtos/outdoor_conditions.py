"""봄이의 야외 활동 판단에 쓰는 날씨·대기질 DTO."""

from __future__ import annotations

from pydantic import BaseModel, Field


class WeatherConditions(BaseModel):
    temperature_c: float | None = Field(default=None, description="현재 기온(섭씨)")
    humidity_percent: int | None = Field(default=None, description="습도(%)")
    precipitation_type: str = Field(description="강수 상태")
    precipitation_mm: float | None = Field(default=None, description="1시간 강수량(mm)")
    wind_speed_mps: float | None = Field(default=None, description="풍속(m/s)")


class AirQualityConditions(BaseModel):
    region_name: str = Field(description="조회한 시도 권역")
    station_name: str | None = Field(default=None, description="측정소명")
    pm10: int | None = Field(default=None, description="미세먼지 PM10(㎍/㎥)")
    pm25: int | None = Field(default=None, description="초미세먼지 PM2.5(㎍/㎥)")
    pm10_grade: str | None = Field(default=None, description="PM10 등급")
    pm25_grade: str | None = Field(default=None, description="PM2.5 등급")


class OutdoorConditionsResult(BaseModel):
    """두 공공 API 결과를 묶은 비진단용 야외 환경 정보."""

    latitude: float
    longitude: float
    weather: WeatherConditions | None = None
    air_quality: AirQualityConditions | None = None
    errors: list[str] = Field(default_factory=list)
