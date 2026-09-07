"""공공데이터포털(data.go.kr) 국립중앙의료원(NMC) 기반 의료시설(응급실, 병원, 약국) 조회 클라이언트.

비동기 httpx 클라이언트를 사용하며 실시간 진료/영업시간(시작/종료/휴게시간) 및 현재 진료 중 여부를 판정합니다.
API 키나 원본 응답 전체를 로그에 남기지 않습니다.
"""

from __future__ import annotations

import json
import logging
import math
import re
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from app.core import config
from app.dtos.medical_facility import FacilityItem, FacilitySearchResult

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 10.0
_EMERGENCY_NOTICE = (
    "응급 상황 시 지체 없이 119에 도움을 요청하시거나, "
    "출발 전 해당 응급실에 직접 전화하여 진료 및 수용 가능 여부를 반드시 확인하시기 바랍니다."
)

_NMC_DEPARTMENT_CODES = {
    "내과": "D001",
    "소아과": "D002",
    "소아청소년과": "D002",
    "신경과": "D003",
    "정신과": "D004",
    "정신건강의학과": "D004",
    "외과": "D005",
    "정형외과": "D006",
    "신경외과": "D007",
    "심장혈관흉부외과": "D008",
    "성형외과": "D009",
    "산부인과": "D010",
    "안과": "D011",
    "이비인후과": "D012",
    "피부과": "D013",
    "비뇨의학과": "D014",
    "비뇨기과": "D014",
    "영상의학과": "D016",
    "마취통증의학과": "D020",
    "통증의학과": "D020",
    "재활의학과": "D021",
    "가정의학과": "D022",
    "응급의학과": "D023",
    "치과": "D026",
    "한방": "D034",
    "한의원": "D034",
}

_SEOUL_DISTRICTS = [
    "강남구",
    "강동구",
    "강북구",
    "강서구",
    "관악구",
    "광진구",
    "구로구",
    "금천구",
    "노원구",
    "도봉구",
    "동대문구",
    "동작구",
    "마포구",
    "서대문구",
    "서초구",
    "성동구",
    "성북구",
    "송파구",
    "양천구",
    "영등포구",
    "용산구",
    "은평구",
    "종로구",
    "중구",
    "중랑구",
]

_PROVINCE_MAP: dict[str, str] = {
    "서울": "서울특별시",
    "서울특별시": "서울특별시",
    "부산": "부산광역시",
    "부산광역시": "부산광역시",
    "대구": "대구광역시",
    "대구광역시": "대구광역시",
    "인천": "인천광역시",
    "인천광역시": "인천광역시",
    "광주": "광주광역시",
    "광주광역시": "광주광역시",
    "대전": "대전광역시",
    "대전광역시": "대전광역시",
    "울산": "울산광역시",
    "울산광역시": "울산광역시",
    "세종": "세종특별자치시",
    "세종시": "세종특별자치시",
    "세종특별자치시": "세종특별자치시",
    "경기": "경기도",
    "경기도": "경기도",
    "강원": "강원특별자치도",
    "강원도": "강원특별자치도",
    "강원특별자치도": "강원특별자치도",
    "충북": "충청북도",
    "충청북도": "충청북도",
    "충남": "충청남도",
    "충청남도": "충청남도",
    "전북": "전북특별자치도",
    "전라북도": "전북특별자치도",
    "전북특별자치도": "전북특별자치도",
    "전남": "전라남도",
    "전라남도": "전라남도",
    "경북": "경상북도",
    "경상북도": "경상북도",
    "경남": "경상남도",
    "경상남도": "경상남도",
    "제주": "제주특별자치도",
    "제주도": "제주특별자치도",
    "제주특별자치도": "제주특별자치도",
}

_LANDMARK_TO_STAGE: dict[str, tuple[str, str | None]] = {
    # 서울 주요 상권/역
    "홍대": ("서울특별시", "마포구"),
    "홍대입구": ("서울특별시", "마포구"),
    "서교동": ("서울특별시", "마포구"),
    "합정": ("서울특별시", "마포구"),
    "망원": ("서울특별시", "마포구"),
    "공덕": ("서울특별시", "마포구"),
    "상암": ("서울특별시", "마포구"),
    "강남": ("서울특별시", "강남구"),
    "강남역": ("서울특별시", "강남구"),
    "역삼": ("서울특별시", "강남구"),
    "선릉": ("서울특별시", "강남구"),
    "삼성": ("서울특별시", "강남구"),
    "대치": ("서울특별시", "강남구"),
    "신사": ("서울특별시", "강남구"),
    "논현": ("서울특별시", "강남구"),
    "압구정": ("서울특별시", "강남구"),
    "종로": ("서울특별시", "종로구"),
    "광화문": ("서울특별시", "종로구"),
    "혜화": ("서울특별시", "종로구"),
    "대학로": ("서울특별시", "종로구"),
    "안국": ("서울특별시", "종로구"),
    "명동": ("서울특별시", "중구"),
    "을지로": ("서울특별시", "중구"),
    "충무로": ("서울특별시", "중구"),
    "동대문": ("서울특별시", "중구"),
    "장충동": ("서울특별시", "중구"),
    "회현": ("서울특별시", "중구"),
    "여의도": ("서울특별시", "영등포구"),
    "영등포": ("서울특별시", "영등포구"),
    "당산": ("서울특별시", "영등포구"),
    "문래": ("서울특별시", "영등포구"),
    "신촌": ("서울특별시", "서대문구"),
    "이대": ("서울특별시", "서대문구"),
    "연희동": ("서울특별시", "서대문구"),
    "홍제동": ("서울특별시", "서대문구"),
    # 경기 주요 시/상권
    "수원": ("경기도", "수원시"),
    "수원역": ("경기도", "수원시"),
    "성남": ("경기도", "성남시"),
    "판교": ("경기도", "성남시 분당구"),
    "분당": ("경기도", "성남시 분당구"),
    "서현": ("경기도", "성남시 분당구"),
    "야탑": ("경기도", "성남시 분당구"),
    "정자": ("경기도", "성남시 분당구"),
    "고양": ("경기도", "고양시"),
    "일산": ("경기도", "고양시 일산동구"),
    "용인": ("경기도", "용인시"),
    "수지": ("경기도", "용인시 수지구"),
    "부천": ("경기도", "부천시"),
    "안산": ("경기도", "안산시"),
    "안양": ("경기도", "안양시"),
    "평촌": ("경기도", "안양시 동안구"),
    "범계": ("경기도", "안양시 동안구"),
    "화성": ("경기도", "화성시"),
    "동탄": ("경기도", "화성시"),
    "평택": ("경기도", "평택시"),
    "의정부": ("경기도", "의정부시"),
    "파주": ("경기도", "파주시"),
    "운정": ("경기도", "파주시"),
    "김포": ("경기도", "김포시"),
    "광명": ("경기도", "광명시"),
    "하남": ("경기도", "하남시"),
    "미사": ("경기도", "하남시"),
    # 부산 주요 구/상권
    "해운대": ("부산광역시", "해운대구"),
    "서면": ("부산광역시", "부산진구"),
    "광안리": ("부산광역시", "수영구"),
    "남포동": ("부산광역시", "중구"),
    "동래": ("부산광역시", "동래구"),
    # 대구 주요 상권
    "동성로": ("대구광역시", "중구"),
    "수성구": ("대구광역시", "수성구"),
    "동대구역": ("대구광역시", "동구"),
    # 인천 주요 구/상권
    "부평": ("인천광역시", "부평구"),
    "송도": ("인천광역시", "연수구"),
    "구월동": ("인천광역시", "남동구"),
    "청라": ("인천광역시", "서구"),
    # 광주 주요 상권
    "충장로": ("광주광역시", "동구"),
    "상무지구": ("광주광역시", "서구"),
    # 대전 주요 상권
    "둔산동": ("대전광역시", "서구"),
    "유성": ("대전광역시", "유성구"),
    # 울산 주요 상권
    "삼산동": ("울산광역시", "남구"),
    # 강원 주요 시
    "춘천": ("강원특별자치도", "춘천시"),
    "원주": ("강원특별자치도", "원주시"),
    "강릉": ("강원특별자치도", "강릉시"),
    "속초": ("강원특별자치도", "속초시"),
    # 충청 주요 시
    "천안": ("충청남도", "천안시"),
    "불당동": ("충청남도", "천안시 서북구"),
    "아산": ("충청남도", "아산시"),
    "청주": ("충청북도", "청주시"),
    "충주": ("충청북도", "충주시"),
    # 전라 주요 시
    "전주": ("전북특별자치도", "전주시"),
    "익산": ("전북특별자치도", "익산시"),
    "군산": ("전북특별자치도", "군산시"),
    "여수": ("전라남도", "여수시"),
    "순천": ("전라남도", "순천시"),
    "목포": ("전라남도", "목포시"),
    # 경상 주요 시
    "포항": ("경상북도", "포항시"),
    "구미": ("경상북도", "구미시"),
    "경주": ("경상북도", "경주시"),
    "창원": ("경상남도", "창원시"),
    "마산": ("경상남도", "창원시 마산회원구"),
    "진해": ("경상남도", "창원시 진해구"),
    "김해": ("경상남도", "김해시"),
    "진주": ("경상남도", "진주시"),
    "양산": ("경상남도", "양산시"),
    # 제주
    "제주시": ("제주특별자치도", "제주시"),
    "서귀포": ("제주특별자치도", "서귀포시"),
    "서귀포시": ("제주특별자치도", "서귀포시"),
}

_LANDMARK_COORDS: dict[str, tuple[float, float]] = {
    # 강남 / 서초
    "강남역": (37.4979, 127.0276),
    "강남": (37.4979, 127.0276),
    "역삼역": (37.5006, 127.0365),
    "역삼": (37.5006, 127.0365),
    "선릉역": (37.5045, 127.0490),
    "선릉": (37.5045, 127.0490),
    "삼성역": (37.5088, 127.0631),
    "삼성": (37.5088, 127.0631),
    "코엑스": (37.5118, 127.0592),
    "신논현역": (37.5045, 127.0254),
    "신논현": (37.5045, 127.0254),
    "논현역": (37.5111, 127.0215),
    "논현": (37.5111, 127.0215),
    "신사역": (37.5163, 127.0202),
    "신사": (37.5163, 127.0202),
    "가로수길": (37.5195, 127.0229),
    "압구정역": (37.5270, 127.0285),
    "압구정": (37.5270, 127.0285),
    "압구정로데오": (37.5268, 127.0405),
    "양재역": (37.4842, 127.0346),
    "양재": (37.4842, 127.0346),
    "고속터미널": (37.5049, 127.0049),
    "반포": (37.5082, 127.0118),
    "교대역": (37.4934, 127.0142),
    "교대": (37.4934, 127.0142),
    "서초": (37.4919, 127.0078),
    "사당역": (37.4765, 126.9816),
    "사당": (37.4765, 126.9816),
    # 마포 / 서대문 / 신촌 / 홍대
    "홍대입구역": (37.5575, 126.9254),
    "홍대입구": (37.5575, 126.9254),
    "홍대": (37.5575, 126.9254),
    "합정역": (37.5495, 126.9137),
    "합정": (37.5495, 126.9137),
    "망원역": (37.5560, 126.9101),
    "망원": (37.5560, 126.9101),
    "상수": (37.5478, 126.9229),
    "연남동": (37.5620, 126.9250),
    "연희동": (37.5702, 126.9304),
    "신촌역": (37.5552, 126.9369),
    "신촌": (37.5552, 126.9369),
    "이대역": (37.5568, 126.9463),
    "이대": (37.5568, 126.9463),
    "공덕역": (37.5444, 126.9515),
    "공덕": (37.5444, 126.9515),
    "상암": (37.5794, 126.8890),
    "DMC": (37.5772, 126.9015),
    # 종로 / 중구 / 도심
    "광화문역": (37.5716, 126.9765),
    "광화문": (37.5716, 126.9765),
    "시청역": (37.5657, 126.9772),
    "시청": (37.5657, 126.9772),
    "서울역": (37.5559, 126.9723),
    "종각역": (37.5702, 126.9830),
    "종각": (37.5702, 126.9830),
    "종로3가": (37.5716, 126.9918),
    "종로": (37.5702, 126.9830),
    "명동역": (37.5609, 126.9863),
    "명동": (37.5609, 126.9863),
    "을지로입구": (37.5660, 126.9822),
    "을지로3가": (37.5663, 126.9922),
    "을지로": (37.5663, 126.9922),
    "충무로역": (37.5612, 126.9942),
    "충무로": (37.5612, 126.9942),
    "동대문역": (37.5714, 127.0097),
    "동대문": (37.5714, 127.0097),
    "DDP": (37.5668, 127.0095),
    "혜화역": (37.5823, 127.0019),
    "혜화": (37.5823, 127.0019),
    "대학로": (37.5823, 127.0019),
    "안국역": (37.5765, 126.9854),
    "안국": (37.5765, 126.9854),
    "장충동": (37.5598, 127.0094),
    "회현": (37.5585, 126.9784),
    # 영등포 / 여의도
    "여의도역": (37.5216, 126.9242),
    "여의도": (37.5216, 126.9242),
    "영등포역": (37.5158, 126.9076),
    "영등포": (37.5158, 126.9076),
    "당산역": (37.5348, 126.9027),
    "당산": (37.5348, 126.9027),
    "문래역": (37.5179, 126.8948),
    "문래": (37.5179, 126.8948),
    # 송파 / 강동 / 광진 / 성동
    "잠실역": (37.5133, 127.1001),
    "잠실": (37.5133, 127.1001),
    "건대입구": (37.5404, 127.0692),
    "건대": (37.5404, 127.0692),
    "성수역": (37.5446, 127.0559),
    "성수": (37.5446, 127.0559),
    "뚝섬역": (37.5472, 127.0474),
    "왕십리역": (37.5615, 127.0378),
    "왕십리": (37.5615, 127.0378),
    "천호역": (37.5386, 127.1234),
    "천호": (37.5386, 127.1234),
    # 기타 서울
    "노원역": (37.6562, 127.0632),
    "노원": (37.6562, 127.0632),
    "수유역": (37.6380, 127.0257),
    "수유": (37.6380, 127.0257),
    "미아사거리": (37.6133, 127.0301),
    "신림역": (37.4842, 126.9297),
    "신림": (37.4842, 126.9297),
    "서울대입구": (37.4812, 126.9527),
    "구로디지털단지": (37.4852, 126.9015),
    "가산디지털단지": (37.4811, 126.8827),
    "목동": (37.5262, 126.8643),
    # 경기 / 인천 / 기타
    "판교역": (37.3948, 127.1119),
    "판교": (37.3948, 127.1119),
    "분당": (37.3827, 127.1189),
    "서현역": (37.3851, 127.1243),
    "서현": (37.3851, 127.1243),
    "야탑역": (37.4114, 127.1287),
    "야탑": (37.4114, 127.1287),
    "정자역": (37.3670, 127.1084),
    "정자": (37.3670, 127.1084),
    "수원역": (37.2657, 127.0000),
    "일산": (37.6584, 126.7700),
    "부평역": (37.4895, 126.7241),
    "부평": (37.4895, 126.7241),
    "송도": (37.3927, 126.6391),
    "해운대": (35.1631, 129.1636),
    "서면": (35.1578, 129.0591),
    # 서울 25개 자치구 중심 좌표 (행정구 단위 검색 시에도 위치기반 거리순 정렬 보장)
    "강남구": (37.5172, 127.0473),
    "강동구": (37.5301, 127.1238),
    "강북구": (37.6396, 127.0255),
    "강서구": (37.5509, 126.8495),
    "관악구": (37.4784, 126.9516),
    "광진구": (37.5385, 127.0824),
    "구로구": (37.4954, 126.8874),
    "금천구": (37.4568, 126.8954),
    "노원구": (37.6542, 127.0568),
    "도봉구": (37.6688, 127.0471),
    "동대문구": (37.5744, 127.0400),
    "동작구": (37.5124, 126.9393),
    "마포구": (37.5663, 126.9016),
    "서대문구": (37.5791, 126.9368),
    "서초구": (37.4837, 127.0324),
    "성동구": (37.5633, 127.0371),
    "성북구": (37.5891, 127.0182),
    "송파구": (37.5145, 127.1058),
    "양천구": (37.5169, 126.8665),
    "영등포구": (37.5264, 126.8962),
    "용산구": (37.5326, 126.9900),
    "은평구": (37.6027, 126.9291),
    "종로구": (37.5730, 126.9794),
    "중구": (37.5641, 126.9979),
    "중랑구": (37.6065, 127.0927),
    "서울": (37.5665, 126.9780),
    "서울특별시": (37.5665, 126.9780),
    "부산": (35.1796, 129.0756),
    "부산광역시": (35.1796, 129.0756),
    "대구": (35.8714, 128.6014),
    "대구광역시": (35.8714, 128.6014),
    "인천": (37.4563, 126.7052),
    "인천광역시": (37.4563, 126.7052),
    "광주": (35.1601, 126.8515),
    "광주광역시": (35.1601, 126.8515),
    "대전": (36.3504, 127.3845),
    "대전광역시": (36.3504, 127.3845),
    "울산": (35.5384, 129.3114),
    "울산광역시": (35.5384, 129.3114),
    "세종": (36.4800, 127.2890),
    "세종시": (36.4800, 127.2890),
    "세종특별자치시": (36.4800, 127.2890),
    "경기": (37.2750, 127.0094),
    "경기도": (37.2750, 127.0094),
    "강원": (37.8853, 127.7298),
    "강원도": (37.8853, 127.7298),
    "강원특별자치도": (37.8853, 127.7298),
    "충북": (36.6358, 127.4914),
    "충청북도": (36.6358, 127.4914),
    "충남": (36.6588, 126.6728),
    "충청남도": (36.6588, 126.6728),
    "전북": (35.8206, 127.1087),
    "전라북도": (35.8206, 127.1087),
    "전북특별자치도": (35.8206, 127.1087),
    "전남": (34.8160, 126.4630),
    "전라남도": (34.8160, 126.4630),
    "경북": (36.5760, 128.5056),
    "경상북도": (36.5760, 128.5056),
    "경남": (35.2383, 128.6924),
    "경상남도": (35.2383, 128.6924),
    "제주": (33.4890, 126.4983),
    "제주도": (33.4890, 126.4983),
    "제주특별자치도": (33.4890, 126.4983),
    # 전국 주요 거점 도시 및 상권
    "광안리": (35.1532, 129.1189),
    "남포동": (35.0979, 129.0348),
    "부산역": (35.1152, 129.0422),
    "동래": (35.2052, 129.0838),
    "동성로": (35.8687, 128.5968),
    "동대구역": (35.8778, 128.6285),
    "반월당": (35.8655, 128.5934),
    "수성구": (35.8583, 128.6306),
    "구월동": (37.4449, 126.7056),
    "청라": (37.5385, 126.6553),
    "충장로": (35.1481, 126.9189),
    "상무지구": (35.1532, 126.8514),
    "수완지구": (35.1915, 126.8220),
    "광주송정역": (35.1376, 126.7915),
    "둔산동": (36.3551, 127.3782),
    "유성": (36.3537, 127.3415),
    "은행동": (36.3276, 127.4273),
    "대전역": (36.3315, 127.4332),
    "삼산동": (35.5396, 129.3361),
    "성남동": (35.5539, 129.3204),
    "수원": (37.2636, 127.0286),
    "성남": (37.4200, 127.1265),
    "고양": (37.6584, 126.8320),
    "용인": (37.2411, 127.1776),
    "수지": (37.3222, 127.0975),
    "부천": (37.5034, 126.7660),
    "안산": (37.3219, 126.8309),
    "안양": (37.3943, 126.9568),
    "범계": (37.3900, 126.9507),
    "평촌": (37.3943, 126.9639),
    "평택": (36.9921, 127.1129),
    "화성": (37.1995, 126.8315),
    "동탄": (37.2006, 127.0747),
    "남양주": (37.6360, 127.2165),
    "의정부": (37.7381, 127.0337),
    "파주": (37.7600, 126.7800),
    "운정": (37.7126, 126.7612),
    "김포": (37.6152, 126.7157),
    "광명": (37.4786, 126.8647),
    "하남": (37.5393, 127.2148),
    "미사": (37.5615, 127.1929),
    "춘천": (37.8813, 127.7298),
    "원주": (37.3422, 127.9202),
    "강릉": (37.7519, 128.8761),
    "속초": (38.2070, 128.5918),
    "천안": (36.8151, 127.1139),
    "불당동": (36.8122, 127.1085),
    "아산": (36.7898, 127.0018),
    "청주": (36.6424, 127.4890),
    "충주": (36.9910, 127.9260),
    "전주": (35.8242, 127.1480),
    "익산": (35.9483, 126.9576),
    "군산": (35.9676, 126.7366),
    "여수": (34.7604, 127.6622),
    "순천": (34.9507, 127.4872),
    "목포": (34.8118, 126.3922),
    "포항": (36.0190, 129.3435),
    "구미": (36.1195, 128.3446),
    "경주": (35.8562, 129.2247),
    "창원": (35.2281, 128.6811),
    "마산": (35.2185, 128.5830),
    "진해": (35.1495, 128.6636),
    "김해": (35.2285, 128.8894),
    "진주": (35.1802, 128.1076),
    "양산": (35.3350, 129.0373),
    "제주시": (33.4996, 126.5312),
    "서귀포": (33.2541, 126.5601),
    "서귀포시": (33.2541, 126.5601),
}


def calculate_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> int:
    """두 위경도 좌표 간의 거리(미터 단위)를 계산합니다 (Haversine formula)."""
    r = 6371000  # 지구 반경 (m)
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return int(r * c)


def evaluate_operating_hours(
    start_val: Any,
    end_val: Any,
    etc_str: str | None = None,
    now: datetime | None = None,
) -> tuple[bool | None, str | None, str | None]:
    """오픈/마감 시각 및 휴게시간으로부터 실시간 진료/영업 여부를 계산합니다."""
    if not now:
        now = datetime.now(ZoneInfo("Asia/Seoul"))
    if not start_val or not end_val:
        return None, None, None

    try:
        s_int = int(str(start_val).zfill(4))
        e_int = int(str(end_val).zfill(4))
    except (ValueError, TypeError):
        return None, None, None

    cur_int = now.hour * 100 + now.minute

    s_str = f"{s_int // 100:02d}:{s_int % 100:02d}"
    e_str = f"{e_int // 100:02d}:{e_int % 100:02d}"
    today_hours = f"{s_str} ~ {e_str}"

    break_hours: str | None = None
    break_s: int | None = None
    break_e: int | None = None

    if etc_str:
        m = re.search(r"(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})", etc_str)
        if m:
            b1, b2 = m.group(1), m.group(2)
            break_hours = f"{b1} ~ {b2}"
            try:
                break_s = int(b1.replace(":", ""))
                break_e = int(b2.replace(":", ""))
            except ValueError:
                pass

    if e_int < s_int:  # 자정 넘어 새벽까지 운영
        is_open = cur_int >= s_int or cur_int < e_int
    else:
        is_open = s_int <= cur_int <= e_int

    if is_open and break_s and break_e:
        if break_s <= cur_int < break_e:
            is_open = False  # 점심/휴게시간 중

    return is_open, today_hours, break_hours


def _optional_text(value: Any) -> str | None:
    """공공데이터의 문자열/숫자 혼용 값을 DTO에 안전하게 전달한다."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


class MedicalFacilityClient:
    """국립중앙의료원(NMC) 공공 API 클라이언트."""

    def __init__(
        self,
        api_key: str | None = None,
        emergency_api_key: str | None = None,
        hospital_api_key: str | None = None,
        pharmacy_api_key: str | None = None,
        kakao_api_key: str | None = None,
        kakao_client: Any = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.emergency_api_key = (
            emergency_api_key
            if emergency_api_key is not None
            else (api_key if api_key is not None else config.EMERGENCY_MEDICAL_API_KEY)
        )
        self.hospital_api_key = (
            hospital_api_key
            if hospital_api_key is not None
            else (api_key if api_key is not None else config.HOSPITAL_INFO_API_KEY)
        )
        self.pharmacy_api_key = (
            pharmacy_api_key
            if pharmacy_api_key is not None
            else (api_key if api_key is not None else config.PHARMACY_INFO_API_KEY)
        )
        self.kakao_api_key = self._clean_key(
            kakao_api_key if kakao_api_key is not None else config.KAKAO_REST_API_KEY
        )
        self._http_client = http_client

    def _get_client(self) -> httpx.AsyncClient:
        if self._http_client is not None:
            return self._http_client
        return httpx.AsyncClient(timeout=_TIMEOUT_SECONDS)

    def _get_api_key(self, facility_type: str = "emergency") -> str | None:
        if facility_type == "hospital":
            raw = self.hospital_api_key or self.emergency_api_key
        elif facility_type == "pharmacy":
            raw = self.pharmacy_api_key or self.emergency_api_key
        else:
            raw = self.emergency_api_key
        return self._clean_key(raw)

    @staticmethod
    def _clean_key(key: str | None) -> str | None:
        if not key:
            return None
        return urllib.parse.unquote(key.strip())

    @staticmethod
    def _parse_xml_or_json(text: str) -> dict[str, Any] | None:
        text_stripped = text.strip()
        if text_stripped.startswith("{") or text_stripped.startswith("["):
            try:
                return json.loads(text_stripped)
            except Exception:
                pass
        if text_stripped.startswith("<"):
            try:
                root = ET.fromstring(text_stripped)
                items = []
                for item_elem in root.findall(".//item"):
                    item_dict = {child.tag: child.text for child in item_elem if child.tag}
                    items.append(item_dict)
                return {"response": {"body": {"items": {"item": items}}}}
            except Exception:
                pass
        return None

    @staticmethod
    def _extract_items(data: dict[str, Any] | None) -> list[dict[str, Any]]:
        if not data:
            return []
        items = data.get("response", {}).get("body", {}).get("items", {}).get("item", [])
        # NMC는 결과가 없을 때 items를 빈 객체가 아닌 빈 문자열로 내려준다.
        # 이는 정상적인 0건 응답이므로 파싱 오류로 취급하지 않는다.
        if not isinstance(items, (dict, list)):
            return []
        if isinstance(items, dict):
            return [items]
        if isinstance(items, list):
            return items
        if "item" in data:
            it = data["item"]
            return [it] if isinstance(it, dict) else it
        return []

    @staticmethod
    def _parse_location(query: str | None) -> tuple[str | None, str | None]:
        if not query:
            return None, None
        # 1. 랜드마크/시군구 사전 매핑 (긴 키워드 우선)
        for k, v in sorted(_LANDMARK_TO_STAGE.items(), key=lambda x: len(x[0]), reverse=True):
            if k in query:
                return v
        # 2. 서울 25개 자치구
        for d in _SEOUL_DISTRICTS:
            if d in query or d[:-1] in query:
                return "서울특별시", d
        # 3. 17개 광역시·도 단독 매칭 (긴 이름 우선: '부산광역시' > '부산')
        for p_key, p_val in sorted(_PROVINCE_MAP.items(), key=lambda x: len(x[0]), reverse=True):
            if p_key in query:
                return p_val, None
        return None, None

    @staticmethod
    def _resolve_target_coords(
        lat: float | None,
        lon: float | None,
        query: str | None = None,
    ) -> tuple[float | None, float | None]:
        """GPS 좌표가 있으면 그대로 반환하고, 없으면 질의어 내 주요 역/상권/랜드마크를 좌표로 매핑합니다."""
        if lat is not None and lon is not None:
            return lat, lon
        if not query:
            return None, None
        # 긴 키워드부터 우선 매칭 (예: '홍대입구역' > '홍대입구' > '홍대')
        for landmark in sorted(_LANDMARK_COORDS.keys(), key=len, reverse=True):
            if landmark in query:
                return _LANDMARK_COORDS[landmark]
        return None, None

    @staticmethod
    def _extract_place_query(query: str | None) -> str | None:
        """시설·진료과 표현을 제외한 지명만 카카오 장소 검색에 전달한다."""
        if not query:
            return None
        department_words = "|".join(sorted(map(re.escape, _NMC_DEPARTMENT_CODES), key=len, reverse=True))
        place = re.sub(
            rf"({department_words}|응급실|응급의료기관|병원|의원|약국|찾아줘|찾아|알려줘|알려|조회|검색|근처|주변|가까운|현재|지금|좀|해줘)",
            "",
            query,
        ).strip()
        return place or None

    async def _resolve_search_coords(
        self,
        client: httpx.AsyncClient,
        latitude: float | None,
        longitude: float | None,
        query: str | None,
    ) -> tuple[float | None, float | None]:
        """명시 지명 → 카카오 장소 검색 → 브라우저 GPS 순으로 기준 좌표를 정한다."""
        place_query = self._extract_place_query(query)
        if self.kakao_api_key and place_query:
            try:
                response = await client.get(
                    "https://dapi.kakao.com/v2/local/search/keyword.json",
                    params={"query": place_query, "size": "1"},
                    headers={"Authorization": f"KakaoAK {self.kakao_api_key}"},
                )
                if response.status_code == 200:
                    documents = response.json().get("documents", [])
                    if documents:
                        first = documents[0]
                        return float(first["y"]), float(first["x"])
                else:
                    logger.warning("카카오 장소 검색 응답 오류: status=%s", response.status_code)
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                logger.warning("카카오 장소 검색 실패")

        # 카카오 검색이 실패했을 때만 기존 주요 지명 사전을 보조 수단으로 쓴다.
        # 예: "운정중앙역"에 "운정"의 넓은 중심 좌표가 먼저 매칭되는 것을 막는다.
        query_lat, query_lon = self._resolve_target_coords(None, None, query)
        if query_lat is not None and query_lon is not None:
            return query_lat, query_lon

        return latitude, longitude

    async def _resolve_stage_from_coordinates(
        self,
        client: httpx.AsyncClient,
        latitude: float | None,
        longitude: float | None,
    ) -> tuple[str | None, str | None]:
        """카카오 좌표→행정구역 API 결과를 NMC 시도/시군구 형식으로 바꾼다."""
        if not self.kakao_api_key or latitude is None or longitude is None:
            return None, None
        try:
            response = await client.get(
                "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json",
                params={"x": str(longitude), "y": str(latitude)},
                headers={"Authorization": f"KakaoAK {self.kakao_api_key}"},
            )
            if response.status_code != 200:
                logger.warning("카카오 행정구역 검색 응답 오류: status=%s", response.status_code)
                return None, None
            documents = response.json().get("documents", [])
            legal_region = next(
                (document for document in documents if document.get("region_type") == "B"),
                None,
            )
            if not legal_region:
                return None, None
            raw_stage1 = legal_region.get("region_1depth_name")
            stage1 = _PROVINCE_MAP.get(raw_stage1, raw_stage1)
            # 카카오는 "고양시 일산동구"처럼 시·구를 합쳐 주지만, NMC Q1은
            # 가장 하위 시군구 값("일산동구")만 허용한다.
            raw_stage2 = legal_region.get("region_2depth_name") or ""
            stage2 = raw_stage2.split()[-1] if raw_stage2 else None
            return stage1, stage2
        except (httpx.HTTPError, ValueError, TypeError):
            logger.warning("카카오 행정구역 검색 실패")
            return None, None

    @staticmethod
    def _match_department(query: str | None, keyword: str | None) -> tuple[str | None, str | None]:
        text = f"{query or ''} {keyword or ''}".strip()
        for dept_name, code in _NMC_DEPARTMENT_CODES.items():
            if dept_name in text:
                return dept_name, code
        return None, None

    @staticmethod
    def _extract_location_label(query: str | None, stage2: str | None) -> str:
        """'강남역 약국', '홍대 내과', '종로구' 등에서 '강남역', '홍대', '종로구'와 같은 지역 표기를 추출합니다."""
        if not query and not stage2:
            return "주변"
        # 사용자가 입력한 지명은 축약하지 않는다. "운정중앙역"을 "운정"으로
        # 바꾸면 서로 다른 역 검색 결과가 같은 장소처럼 보이게 된다.
        query_label = MedicalFacilityClient._extract_place_query(query)
        if query_label:
            return query_label
        target = query or stage2 or ""
        # 1. 랜드마크/구 키워드 먼저 검사 (긴 단어부터 매칭)
        for lm in sorted(_LANDMARK_COORDS.keys(), key=len, reverse=True):
            if lm in target:
                return lm
        for d in _SEOUL_DISTRICTS:
            if d in target or d[:-1] in target:
                return d
        # 2. 불필요한 단어 제거 후 남은 단어
        department_words = "|".join(sorted(map(re.escape, _NMC_DEPARTMENT_CODES), key=len, reverse=True))
        cleaned = re.sub(
            rf"({department_words}|약국|병원|의원|응급실|찾아줘|알려줘|어디|주변|근처)",
            "",
            target,
        ).strip()
        return cleaned if cleaned else "주변"

    # ==========================================
    # 1. 응급실 검색 (ErmctInfoInqireService)
    # ==========================================
    async def search_nearby_emergency_room(
        self,
        latitude: float | None = None,
        longitude: float | None = None,
        stage1: str | None = None,
        stage2: str | None = None,
        radius: int = 10000,
        query: str | None = None,
    ) -> FacilitySearchResult:
        key = self._get_api_key()
        if not key:
            return FacilitySearchResult(
                facility_type="emergency_room",
                total_count=0,
                items=[],
                emergency_notice=_EMERGENCY_NOTICE,
                error="응급의료 API 키가 설정되지 않았습니다.",
                message="응급실 조회를 위한 공공데이터 API 키가 설정되지 않았습니다. 즉시 119에 연락하세요.",
            )

        client = self._get_client()
        items: list[FacilityItem] = []

        try:
            target_lat, target_lon = await self._resolve_search_coords(
                client, latitude, longitude, query or stage2
            )
            if target_lat is not None and target_lon is not None:
                items = await self._fetch_emergency_by_location(client, key, target_lat, target_lon)

            if not items and (stage1 or stage2 or query):
                parsed_s1, parsed_s2 = self._parse_location(query)
                s1 = stage1 or parsed_s1
                s2 = stage2 or parsed_s2
                items = await self._fetch_emergency_by_stage(
                    client, key, s1, s2, ref_lat=target_lat, ref_lon=target_lon
                )

            if items:
                items.sort(key=lambda x: x.distance_m if x.distance_m is not None else 999999)
                items = items[:5]
                await self._enrich_realtime_beds(client, key, items, stage1, stage2)

            if not items:
                return FacilitySearchResult(
                    facility_type="emergency_room",
                    total_count=0,
                    items=[],
                    emergency_notice=_EMERGENCY_NOTICE,
                    message="주변에 조회된 응급의료기관이 없습니다. 응급 상황 시 즉시 119에 도움을 요청하세요.",
                )

            loc_label = self._extract_location_label(query, stage2)
            prefix = f"{loc_label} 인근 " if loc_label != "주변" else "주변 "
            return FacilitySearchResult(
                facility_type="emergency_room",
                total_count=len(items),
                items=items,
                emergency_notice=_EMERGENCY_NOTICE,
                message=f"{prefix}응급의료기관 {len(items)}곳을 조회했습니다.",
            )

        except httpx.TimeoutException:
            logger.warning("응급의료 API 호출 타임아웃")
            return FacilitySearchResult(
                facility_type="emergency_room",
                total_count=0,
                items=[],
                emergency_notice=_EMERGENCY_NOTICE,
                error="응답 시간 초과",
                message="공공데이터 응답 시간이 초과되었습니다. 위급한 경우 즉시 119에 전화하세요.",
            )
        except Exception as ex:
            logger.warning(f"응급의료 API 호출 오류: {type(ex).__name__}")
            return FacilitySearchResult(
                facility_type="emergency_room",
                total_count=0,
                items=[],
                emergency_notice=_EMERGENCY_NOTICE,
                error=f"오류: {type(ex).__name__}",
                message="응급의료기관 정보 조회 중 오류가 발생했습니다. 위급 시 119에 즉시 연락하세요.",
            )
        finally:
            if self._http_client is None:
                await client.aclose()

    async def _fetch_emergency_by_location(
        self, client: httpx.AsyncClient, key: str, latitude: float, longitude: float
    ) -> list[FacilityItem]:
        url = "https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytLcinfoInqire"
        params = {
            "serviceKey": key,
            "WGS84_LON": str(longitude),
            "WGS84_LAT": str(latitude),
            "pageNo": "1",
            "numOfRows": "10",
            "_type": "json",
        }
        res = await client.get(url, params=params)
        if res.status_code != 200:
            return []
        data = self._parse_xml_or_json(res.text)
        raw_items = self._extract_items(data)
        items: list[FacilityItem] = []
        for it in raw_items:
            name = it.get("dutyName") or "응급의료기관"
            dist_val = it.get("distance")
            dist_m = int(float(dist_val) * 1000) if dist_val is not None else None
            lat_val = it.get("latitude") or it.get("wgs84Lat")
            lon_val = it.get("longitude") or it.get("wgs84Lon")
            lat_f = float(lat_val) if lat_val else None
            lon_f = float(lon_val) if lon_val else None
            if dist_m is None and lat_f is not None and lon_f is not None:
                dist_m = calculate_distance_m(latitude, longitude, lat_f, lon_f)
            em_phone = it.get("dutyTel3")
            items.append(
                FacilityItem(
                    name=name,
                    category=it.get("dutyEmclsName") or it.get("dutyDivName") or "응급의료기관",
                    address=it.get("dutyAddr") or "",
                    phone=_optional_text(it.get("dutyTel1")) or _optional_text(em_phone),
                    emergency_room_phone=_optional_text(em_phone),
                    distance_m=dist_m,
                    latitude=lat_f,
                    longitude=lon_f,
                    hpid=_optional_text(it.get("hpid")),
                    is_open=True,
                    today_hours="24시간 진료",
                )
            )
        return items

    async def _fetch_emergency_by_stage(
        self,
        client: httpx.AsyncClient,
        key: str,
        stage1: str | None,
        stage2: str | None,
        ref_lat: float | None = None,
        ref_lon: float | None = None,
    ) -> list[FacilityItem]:
        url = "https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytListInfoInqire"
        params = {
            "serviceKey": key,
            "Q0": stage1 or "",
            "Q1": stage2 or "",
            "pageNo": "1",
            "numOfRows": "10",
            "_type": "json",
        }
        res = await client.get(url, params=params)
        if res.status_code != 200:
            return []
        data = self._parse_xml_or_json(res.text)
        raw_items = self._extract_items(data)
        items: list[FacilityItem] = []
        for it in raw_items:
            em_phone = it.get("dutyTel3")
            e_lat = float(it["wgs84Lat"]) if it.get("wgs84Lat") else None
            e_lon = float(it["wgs84Lon"]) if it.get("wgs84Lon") else None
            dist_m = None
            if ref_lat is not None and ref_lon is not None and e_lat is not None and e_lon is not None:
                dist_m = calculate_distance_m(ref_lat, ref_lon, e_lat, e_lon)
            items.append(
                FacilityItem(
                    name=it.get("dutyName") or "응급의료기관",
                    category=it.get("dutyEmclsName") or it.get("dutyDivName") or "응급의료기관",
                    address=it.get("dutyAddr") or "",
                    phone=_optional_text(it.get("dutyTel1")) or _optional_text(em_phone),
                    emergency_room_phone=_optional_text(em_phone),
                    distance_m=dist_m,
                    latitude=e_lat,
                    longitude=e_lon,
                    hpid=_optional_text(it.get("hpid")),
                    is_open=True,
                    today_hours="24시간 진료",
                )
            )
        return items

    @staticmethod
    def _format_bed_desc(beds: str) -> str | None:
        if not beds:
            return None
        try:
            b_num = int(beds)
            return f"응급실 {b_num}석 가용" if b_num > 0 else "응급실 만석/대기"
        except ValueError:
            return f"응급실 {beds}석"

    async def _enrich_realtime_beds(
        self,
        client: httpx.AsyncClient,
        key: str,
        items: list[FacilityItem],
        stage1: str | None,
        stage2: str | None,
    ) -> None:
        try:
            s1, s2 = stage1, stage2
            if not s1 and items and items[0].address:
                parts = items[0].address.split()
                if len(parts) >= 2:
                    s1, s2 = parts[0], parts[1]
            if not s1:
                return

            url = "https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire"
            params = {
                "serviceKey": key,
                "STAGE1": s1,
                "STAGE2": s2 or "",
                "pageNo": "1",
                "numOfRows": "20",
                "_type": "json",
            }
            res = await client.get(url, params=params)
            if res.status_code != 200:
                return

            data = self._parse_xml_or_json(res.text)
            bed_items = self._extract_items(data)
            bed_map: dict[str, str] = {b["hpid"]: str(b.get("hvec", "")) for b in bed_items if b.get("hpid")}

            for item in items:
                if item.hpid and item.hpid in bed_map:
                    desc = self._format_bed_desc(bed_map[item.hpid])
                    if desc:
                        item.available_beds = desc
        except Exception as ex:
            logger.debug(f"병상 정보 연계 생략: {ex}")

    # ==========================================
    # 2. 병원 검색 (HsptlAsembySearchService)
    # ==========================================
    async def search_nearby_hospital(
        self,
        latitude: float | None = None,
        longitude: float | None = None,
        radius: int = 3000,
        keyword: str | None = None,
        query: str | None = None,
        stage1: str | None = None,
        stage2: str | None = None,
        only_open: bool = False,
    ) -> FacilitySearchResult:
        """국립중앙의료원 전국 병·의원 찾기 API 기반 병원 검색."""
        key = self._get_api_key()
        if not key:
            return FacilitySearchResult(
                facility_type="hospital",
                total_count=0,
                items=[],
                error="병원 API 키가 설정되지 않았습니다.",
                message="병원 조회를 위한 공공데이터 API 키가 설정되지 않았습니다.",
            )

        client = self._get_client()
        items: list[FacilityItem] = []
        dept_name, dept_code = self._match_department(query, keyword)

        parsed_s1, parsed_s2 = self._parse_location(query or keyword)
        target_s1 = stage1 or parsed_s1
        target_s2 = stage2 or parsed_s2

        try:
            target_lat, target_lon = await self._resolve_search_coords(
                client, latitude, longitude, query or keyword or stage2
            )
            # 카카오로 찾은 전국 지명은 기존 사전에 없으므로, 좌표를 한 번 더
            # 행정구역으로 변환해 NMC의 진료과(QD) 조회에 사용한다.
            if dept_code and not target_s1:
                target_s1, target_s2 = await self._resolve_stage_from_coordinates(
                    client, target_lat, target_lon
                )
            # 진료과가 있으면 반드시 과목 코드(QD)로 먼저 조회한다. 위치기반 API는
            # 진료과 파라미터를 지원하지 않아, 이를 먼저 호출하면 일반 의원이
            # "산부인과 병원"처럼 잘못 표시될 수 있다.
            if dept_code and target_s1:
                items = await self._fetch_hospital_by_stage(
                    client,
                    key,
                    target_s1,
                    target_s2,
                    dept_code=dept_code,
                    qn=keyword if not dept_code else None,
                    ref_lat=target_lat,
                    ref_lon=target_lon,
                    num_of_rows=100 if only_open else 20,
                )

            # 지명 없이 진료과만 요청한 경우에는 위치기반 결과 중 명칭/분류에
            # 해당 진료과가 명시된 곳만 사용한다. 과목이 확인되지 않은 일반 의원을
            # 대신 보여주지 않는다.
            if dept_code and not target_s1 and target_lat is not None and target_lon is not None:
                items = await self._fetch_hospital_by_location(
                    client, key, target_lat, target_lon, keyword_filter=dept_name,
                    num_of_rows=100 if only_open else 20,
                )

            # 과목이 없는 일반 병원 검색은 기존처럼 위치기반을 먼저 사용하고,
            # 결과가 없을 때만 지명 검색으로 보완한다.
            if not dept_code:
                if target_lat is not None and target_lon is not None:
                    items = await self._fetch_hospital_by_location(
                        client, key, target_lat, target_lon, keyword_filter=keyword,
                        num_of_rows=100 if only_open else 20,
                    )

                if not items:
                    items = await self._fetch_hospital_by_stage(
                        client,
                        key,
                        target_s1 or "서울특별시",
                        target_s2,
                        dept_code=None,
                        qn=keyword,
                        ref_lat=target_lat,
                        ref_lon=target_lon,
                        num_of_rows=100 if only_open else 20,
                    )

            # 현재 진료 중인 병원을 상단으로 정렬, 그 다음 거리순
            items.sort(key=lambda x: (x.is_open is not True, x.distance_m if x.distance_m is not None else 999999))
            if only_open:
                # 가까운 5곳만 먼저 보지 않는다. 최대 2km 범위의 후보 전체에서
                # 진료 중인 곳을 골라야 사용자의 요청과 일치한다.
                items = [
                    item for item in items
                    if item.is_open is True and item.distance_m is not None and item.distance_m <= 2_000
                ]
            items = items[:5]

            if not items:
                if only_open:
                    return FacilitySearchResult(
                        facility_type="hospital",
                        total_count=0,
                        items=[],
                        message="반경 2km 안에 현재 진료 중으로 확인된 병원이 없습니다. 운영시간은 변동될 수 있으니 방문 전 전화로 확인해 주세요.",
                    )
                search_desc = f"'{query or keyword}' 관련 " if (query or keyword) else ""
                return FacilitySearchResult(
                    facility_type="hospital",
                    total_count=0,
                    items=[],
                    message=f"주변에 조회된 {search_desc}병원이 없습니다.",
                )

            loc_label = self._extract_location_label(query or keyword, stage2)
            prefix = f"{loc_label} 인근 " if loc_label != "주변" else "주변 "
            dept_label = f"{dept_name} " if dept_name else ""
            open_count = sum(1 for it in items if it.is_open is True)
            msg = (
                f"{prefix}{dept_label}병원 {len(items)}곳을 조회했습니다. (현재 진료 중 {open_count}곳)"
                if open_count > 0
                else f"{prefix}{dept_label}병원 {len(items)}곳을 조회했습니다."
            )

            return FacilitySearchResult(
                facility_type="hospital",
                total_count=len(items),
                items=items,
                message=msg,
            )

        except httpx.TimeoutException:
            logger.warning("병원 정보 API 호출 타임아웃")
            return FacilitySearchResult(
                facility_type="hospital",
                total_count=0,
                items=[],
                error="응답 시간 초과",
                message="병원 정보 공공데이터 응답 시간이 초과되었습니다.",
            )
        except Exception as ex:
            logger.warning(f"병원 정보 API 호출 오류: {type(ex).__name__}")
            return FacilitySearchResult(
                facility_type="hospital",
                total_count=0,
                items=[],
                error=f"오류: {type(ex).__name__}",
                message="병원 정보 조회 중 일시적인 오류가 발생했습니다.",
            )
        finally:
            if self._http_client is None:
                await client.aclose()

    async def _fetch_hospital_by_location(
        self,
        client: httpx.AsyncClient,
        key: str,
        latitude: float,
        longitude: float,
        keyword_filter: str | None,
        num_of_rows: int = 20,
    ) -> list[FacilityItem]:
        url = "https://apis.data.go.kr/B552657/HsptlAsembySearchService/getHsptlMdcncLcinfoInqire"
        params = {
            "serviceKey": key,
            "WGS84_LON": str(longitude),
            "WGS84_LAT": str(latitude),
            "pageNo": "1",
            "numOfRows": str(num_of_rows),
            "_type": "json",
        }
        res = await client.get(url, params=params)
        if res.status_code != 200:
            return []
        data = self._parse_xml_or_json(res.text)
        raw_items = self._extract_items(data)
        items: list[FacilityItem] = []
        now = datetime.now(ZoneInfo("Asia/Seoul"))

        for it in raw_items:
            name = it.get("dutyName") or "병원"
            category = it.get("dutyDivName") or "의원"
            if keyword_filter and keyword_filter not in name and keyword_filter not in category:
                continue

            dist_val = it.get("distance")
            dist_m = int(float(dist_val) * 1000) if dist_val is not None else None
            h_lat = (
                float(it["latitude"]) if it.get("latitude") else (float(it["wgs84Lat"]) if it.get("wgs84Lat") else None)
            )
            h_lon = (
                float(it["longitude"])
                if it.get("longitude")
                else (float(it["wgs84Lon"]) if it.get("wgs84Lon") else None)
            )
            if dist_m is None and h_lat is not None and h_lon is not None:
                dist_m = calculate_distance_m(latitude, longitude, h_lat, h_lon)
            is_open, today_hours, break_hours = evaluate_operating_hours(
                it.get("startTime"), it.get("endTime"), etc_str=it.get("dutyEtc"), now=now
            )

            items.append(
                FacilityItem(
                    name=name,
                    category=category,
                    address=it.get("dutyAddr") or "",
                    phone=_optional_text(it.get("dutyTel1")),
                    distance_m=dist_m,
                    latitude=h_lat,
                    longitude=h_lon,
                    hpid=_optional_text(it.get("hpid")),
                    is_open=is_open,
                    today_hours=today_hours,
                    break_hours=break_hours,
                )
            )
        return items

    async def _fetch_hospital_by_stage(
        self,
        client: httpx.AsyncClient,
        key: str,
        stage1: str,
        stage2: str | None,
        dept_code: str | None,
        qn: str | None,
        ref_lat: float | None = None,
        ref_lon: float | None = None,
        num_of_rows: int = 20,
    ) -> list[FacilityItem]:
        url = "https://apis.data.go.kr/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire"
        now = datetime.now(ZoneInfo("Asia/Seoul"))
        weekday_idx = now.weekday() + 1  # 1=월 ~ 7=일
        params: dict[str, Any] = {
            "serviceKey": key,
            "Q0": stage1,
            "pageNo": "1",
            "numOfRows": str(num_of_rows),
            "_type": "json",
        }
        if stage2:
            params["Q1"] = stage2
        if dept_code:
            params["QD"] = dept_code
        if qn:
            params["QN"] = qn

        res = await client.get(url, params=params)
        if res.status_code != 200:
            return []
        data = self._parse_xml_or_json(res.text)
        raw_items = self._extract_items(data)
        items: list[FacilityItem] = []

        for it in raw_items:
            name = it.get("dutyName") or "병원"
            category = it.get("dutyDivNam") or it.get("dutyDivName") or "의원"
            start_k = f"dutyTime{weekday_idx}s"
            close_k = f"dutyTime{weekday_idx}c"
            s_val = it.get(start_k)
            e_val = it.get(close_k)

            is_open, today_hours, break_hours = evaluate_operating_hours(
                s_val, e_val, etc_str=it.get("dutyEtc"), now=now
            )
            h_lat = float(it["wgs84Lat"]) if it.get("wgs84Lat") else None
            h_lon = float(it["wgs84Lon"]) if it.get("wgs84Lon") else None
            dist_m = None
            if ref_lat is not None and ref_lon is not None and h_lat is not None and h_lon is not None:
                dist_m = calculate_distance_m(ref_lat, ref_lon, h_lat, h_lon)

            items.append(
                FacilityItem(
                    name=name,
                    category=category,
                    address=it.get("dutyAddr") or "",
                    phone=_optional_text(it.get("dutyTel1")),
                    distance_m=dist_m,
                    latitude=h_lat,
                    longitude=h_lon,
                    hpid=_optional_text(it.get("hpid")),
                    is_open=is_open,
                    today_hours=today_hours,
                    break_hours=break_hours,
                )
            )
        return items

    # ==========================================
    # 3. 약국 검색 (ErmctInsttInfoInqireService)
    # ==========================================
    async def search_nearby_pharmacy(
        self,
        latitude: float | None = None,
        longitude: float | None = None,
        radius: int = 3000,
        query: str | None = None,
        stage1: str | None = None,
        stage2: str | None = None,
        only_open: bool = False,
    ) -> FacilitySearchResult:
        """국립중앙의료원 전국 약국 API 기반 약국 검색."""
        key = self._get_api_key()
        if not key:
            return FacilitySearchResult(
                facility_type="pharmacy",
                total_count=0,
                items=[],
                error="약국 API 키가 설정되지 않았습니다.",
                message="약국 조회를 위한 공공데이터 API 키가 설정되지 않았습니다.",
            )

        client = self._get_client()
        items: list[FacilityItem] = []

        try:
            target_lat, target_lon = await self._resolve_search_coords(
                client, latitude, longitude, query or stage2
            )
            # 1) GPS 좌표 또는 랜드마크 좌표가 있으면 위치기반 약국 조회 (0.2s, 실제 거리순 + 오늘 영업시간)
            if target_lat is not None and target_lon is not None:
                items = await self._fetch_pharmacy_by_location(client, key, target_lat, target_lon)

            # 2) 좌표가 없거나 결과가 없으면 지명 검색
            if not items:
                parsed_s1, parsed_s2 = self._parse_location(query)
                target_s1 = stage1 or parsed_s1 or "서울특별시"
                target_s2 = stage2 or parsed_s2
                items = await self._fetch_pharmacy_by_stage(
                    client,
                    key,
                    target_s1,
                    target_s2,
                    query,
                    ref_lat=target_lat,
                    ref_lon=target_lon,
                )

            if only_open:
                items = [item for item in items if item.is_open is True]

            # 현재 영업 중인 약국을 상단으로 정렬, 그 다음 거리순
            items.sort(key=lambda x: (x.is_open is not True, x.distance_m if x.distance_m is not None else 999999))
            items = items[:5]

            if not items:
                if only_open:
                    return FacilitySearchResult(
                        facility_type="pharmacy",
                        total_count=0,
                        items=[],
                        message="반경 2km 안에 현재 영업 중으로 확인된 약국이 없습니다. 운영시간은 변동될 수 있으니 방문 전 전화로 확인해 주세요.",
                    )
                search_desc = f"'{query}' 관련 " if query else ""
                return FacilitySearchResult(
                    facility_type="pharmacy",
                    total_count=0,
                    items=[],
                    message=f"주변에 조회된 {search_desc}약국이 없습니다.",
                )

            loc_label = self._extract_location_label(query, stage2)
            prefix = f"{loc_label} 인근 " if loc_label != "주변" else "주변 "
            open_count = sum(1 for it in items if it.is_open is True)
            msg = (
                f"{prefix}약국 {len(items)}곳을 조회했습니다. (현재 영업 중 {open_count}곳)"
                if open_count > 0
                else f"{prefix}약국 {len(items)}곳을 조회했습니다."
            )

            return FacilitySearchResult(
                facility_type="pharmacy",
                total_count=len(items),
                items=items,
                message=msg,
            )

        except httpx.TimeoutException:
            logger.warning("약국 정보 API 호출 타임아웃")
            return FacilitySearchResult(
                facility_type="pharmacy",
                total_count=0,
                items=[],
                error="응답 시간 초과",
                message="약국 정보 공공데이터 응답 시간이 초과되었습니다.",
            )
        except Exception as ex:
            logger.warning(f"약국 정보 API 호출 오류: {type(ex).__name__}")
            return FacilitySearchResult(
                facility_type="pharmacy",
                total_count=0,
                items=[],
                error=f"오류: {type(ex).__name__}",
                message="약국 정보 조회 중 일시적인 오류가 발생했습니다.",
            )
        finally:
            if self._http_client is None:
                await client.aclose()

    async def _fetch_pharmacy_by_location(
        self, client: httpx.AsyncClient, key: str, latitude: float, longitude: float
    ) -> list[FacilityItem]:
        url = "https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyLcinfoInqire"
        params = {
            "serviceKey": key,
            "WGS84_LON": str(longitude),
            "WGS84_LAT": str(latitude),
            "pageNo": "1",
            "numOfRows": "20",
            "_type": "json",
        }
        res = await client.get(url, params=params)
        if res.status_code != 200:
            return []
        data = self._parse_xml_or_json(res.text)
        raw_items = self._extract_items(data)
        items: list[FacilityItem] = []
        now = datetime.now(ZoneInfo("Asia/Seoul"))

        for it in raw_items:
            name = it.get("dutyName") or "약국"
            dist_val = it.get("distance")
            dist_m = int(float(dist_val) * 1000) if dist_val is not None else None
            p_lat = (
                float(it["latitude"]) if it.get("latitude") else (float(it["wgs84Lat"]) if it.get("wgs84Lat") else None)
            )
            p_lon = (
                float(it["longitude"])
                if it.get("longitude")
                else (float(it["wgs84Lon"]) if it.get("wgs84Lon") else None)
            )
            if dist_m is None and p_lat is not None and p_lon is not None:
                dist_m = calculate_distance_m(latitude, longitude, p_lat, p_lon)
            is_open, today_hours, break_hours = evaluate_operating_hours(
                it.get("startTime"), it.get("endTime"), etc_str=it.get("dutyEtc"), now=now
            )

            items.append(
                FacilityItem(
                    name=name,
                    category="약국",
                    address=it.get("dutyAddr") or "",
                    phone=_optional_text(it.get("dutyTel1")),
                    distance_m=dist_m,
                    latitude=p_lat,
                    longitude=p_lon,
                    hpid=_optional_text(it.get("hpid")),
                    is_open=is_open,
                    today_hours=today_hours,
                    break_hours=break_hours,
                )
            )
        return items

    async def _fetch_pharmacy_by_stage(
        self,
        client: httpx.AsyncClient,
        key: str,
        stage1: str,
        stage2: str | None,
        query: str | None,
        ref_lat: float | None = None,
        ref_lon: float | None = None,
    ) -> list[FacilityItem]:
        url = "https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyListInfoInqire"
        now = datetime.now(ZoneInfo("Asia/Seoul"))
        weekday_idx = now.weekday() + 1
        params: dict[str, Any] = {
            "serviceKey": key,
            "Q0": stage1,
            "pageNo": "1",
            "numOfRows": "20",
            "_type": "json",
        }
        if stage2:
            params["Q1"] = stage2

        res = await client.get(url, params=params)
        if res.status_code != 200:
            return []
        data = self._parse_xml_or_json(res.text)
        raw_items = self._extract_items(data)
        items: list[FacilityItem] = []

        for it in raw_items:
            name = it.get("dutyName") or "약국"
            start_k = f"dutyTime{weekday_idx}s"
            close_k = f"dutyTime{weekday_idx}c"
            s_val = it.get(start_k)
            e_val = it.get(close_k)

            is_open, today_hours, break_hours = evaluate_operating_hours(
                s_val, e_val, etc_str=it.get("dutyEtc"), now=now
            )
            p_lat = float(it["wgs84Lat"]) if it.get("wgs84Lat") else None
            p_lon = float(it["wgs84Lon"]) if it.get("wgs84Lon") else None
            dist_m = None
            if ref_lat is not None and ref_lon is not None and p_lat is not None and p_lon is not None:
                dist_m = calculate_distance_m(ref_lat, ref_lon, p_lat, p_lon)

            items.append(
                FacilityItem(
                    name=name,
                    category="약국",
                    address=it.get("dutyAddr") or "",
                    phone=_optional_text(it.get("dutyTel1")),
                    distance_m=dist_m,
                    latitude=p_lat,
                    longitude=p_lon,
                    hpid=_optional_text(it.get("hpid")),
                    is_open=is_open,
                    today_hours=today_hours,
                    break_hours=break_hours,
                )
            )
        return items
