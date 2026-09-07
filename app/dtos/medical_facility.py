from typing import Literal

from pydantic import BaseModel, Field, model_validator


class FacilityItem(BaseModel):
    """주변 의료시설(응급실, 병원, 약국) 개별 항목 정보."""

    name: str = Field(description="시설명 (병원명, 약국명, 응급실명)")
    category: str | None = Field(default=None, description="기관 분류 (종합병원, 의원, 약국 등)")
    address: str = Field(description="소재지 주소")
    phone: str | None = Field(default=None, description="대표 전화번호")
    emergency_room_phone: str | None = Field(default=None, description="응급실 직통 전화번호")
    distance_m: int | None = Field(default=None, description="현재 위치로부터의 거리 (미터)")
    latitude: float | None = Field(default=None, description="위도 (WGS84)")
    longitude: float | None = Field(default=None, description="경도 (WGS84)")
    available_beds: str | None = Field(default=None, description="실시간 가용병상 정보")
    operating_hours: str | None = Field(default=None, description="운영시간 요약")
    homepage: str | None = Field(default=None, description="홈페이지 URL")
    hpid: str | None = Field(default=None, description="기관 고유 식별 코드 (HPID)")


class FacilitySearchResult(BaseModel):
    """주변 의료시설 검색 결과 공통 응답."""

    facility_type: Literal["emergency_room", "hospital", "pharmacy"] = Field(default="emergency_room")
    total_count: int = Field(default=0, description="조회된 시설 수")
    search_type: str | None = Field(default=None, description="facility_type 호환 별칭")
    count: int | None = Field(default=None, description="total_count 호환 별칭")
    items: list[FacilityItem] = Field(default_factory=list, description="조회된 시설 목록")
    emergency_notice: str | None = Field(
        default=None,
        description="응급 상황 시 119 및 사전 전화 확인 필수 안내 문구",
    )
    message: str | None = Field(default=None, description="사용자 친화적 안내 메시지")
    error: str | None = Field(default=None, description="오류 발생 시 안내 문구")

    @model_validator(mode="after")
    def sync_aliases(self) -> "FacilitySearchResult":
        if self.search_type and not self.facility_type:
            self.facility_type = self.search_type  # type: ignore[assignment]
        elif self.facility_type and not self.search_type:
            self.search_type = self.facility_type

        if self.count is not None and self.total_count == 0:
            self.total_count = self.count
        elif self.total_count is not None and self.count is None:
            self.count = self.total_count
        return self
