"""의료시설 검색 질문인지 판별하는 키워드의 단일 진실 원천.

`health_assistant_boundary.py`(fast-path 판정)와 `health_assistant.py`(실제
시설 검색 도구 연결)가 예전에는 이 목록을 각자 따로 복사해 갖고 있었다.
boundary 쪽 목록은 진료과 7개·검색의도 8개뿐인 좁은 부분집합이었고, 예를 들어
"영업중"은 boundary에는 있는데 실제 도구 연결 쪽(`_FACILITY_SEARCH_KEYWORDS`)에는
없어서, "야간약국 영업중인지 알려줘" 같은 질문은 근거가 필수라고 판정만 되고
도구는 안 붙어 조용히 차단됐다. 여기 하나로 모은다.
"""

from __future__ import annotations

import re

FACILITY_KEYWORDS = (
    "응급실",
    "병원",
    "의원",
    "약국",
    "당직의료",
    "당번약국",
    "야간약국",
    "야간진료",
    "응급의료",
    "내과",
    "외과",
    "이비인후과",
    "소아과",
    "소아청소년과",
    "신경과",
    "정신과",
    "정신건강의학과",
    "정형외과",
    "신경외과",
    "성형외과",
    "산부인과",
    "안과",
    "피부과",
    "비뇨의학과",
    "비뇨기과",
    "영상의학과",
    "마취통증의학과",
    "통증의학과",
    "재활의학과",
    "가정의학과",
    "응급의학과",
    "치과",
    "한방",
    "한의원",
    "진료소",
    "보건소",
    "의료원",
)

FACILITY_SEARCH_KEYWORDS = (
    "찾아",
    "검색",
    "조회",
    "알려",
    "추천",
    "가까운",
    "가까이",
    "근처",
    "주변",
    "위치",
    "어디",
    "문 연",
    "문연",
    "진료 중",
    "진료중",
    "운영 중",
    "운영중",
    "영업 중",
    "영업중",
    "가야",
    "갈 수",
    "전화번호",
    "지도",
)

FACILITY_HISTORY_OR_ADVICE_KEYWORDS = (
    "다녀",
    "갔다",
    "왔어",
    "받았",
    "진료받",
    "처방받",
    "기록해",
    "복용",
    "먹어도",
    "부작용",
)

FACILITY_LOCATION_REQUEST_MARKERS = (
    "가까운 병원이나 약국",
    "의료시설",
    "찾으시는 지역명",
    "위치 확인 시간이 초과",
)

_LOCATION_REPLY_PATTERN = re.compile(
    r"^[가-힣A-Za-z0-9\s·-]{1,30}(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구|읍|면|동|리|역)$"
    r"^[가-힣A-Za-z0-9\s·-]{1,30}(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구|읍|면|동|리|역)(?:\s*(?:약국|병원|의원|응급실))?(?:(?:이)?야|살아|요|에\s*있어)?$"
)
_MAJOR_REGION_NAMES = {
    "서울",
    "부산",
    "대구",
    "인천",
    "광주",
    "대전",
    "울산",
    "세종",
    "제주",
}


def is_facility_location_followup(previous_assistant_message: str, user_message: str) -> bool:
    """시설 위치를 되물은 직후의 짧은 지역명 답변만 허용한다."""
    if not any(marker in previous_assistant_message for marker in FACILITY_LOCATION_REQUEST_MARKERS):
        return False
    location = user_message.strip().rstrip(".!?")
    return location in _MAJOR_REGION_NAMES or bool(_LOCATION_REPLY_PATTERN.fullmatch(location))
