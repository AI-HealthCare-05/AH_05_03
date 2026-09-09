import httpx
import pytest

from app.services.medical_facility_client import _SEOUL_DISTRICTS, MedicalFacilityClient

MOCK_EMERGENCY_LCINFO_XML = """<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>00</resultCode>
    <resultMsg>NORMAL SERVICE.</resultMsg>
  </header>
  <body>
    <items>
      <item>
        <dutyName>서울대학교병원</dutyName>
        <dutyAddr>서울특별시 종로구 대학로 101</dutyAddr>
        <dutyTel1>02-2072-2114</dutyTel1>
        <dutyTel3>02-2072-1182</dutyTel3>
        <distance>0.85</distance>
        <wgs84Lat>37.5796</wgs84Lat>
        <wgs84Lon>126.9989</wgs84Lon>
        <hpid>A1100001</hpid>
      </item>
    </items>
    <numOfRows>10</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>1</totalCount>
  </body>
</response>
"""

MOCK_EMERGENCY_BEDS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>00</resultCode>
    <resultMsg>NORMAL SERVICE.</resultMsg>
  </header>
  <body>
    <items>
      <item>
        <hpid>A1100001</hpid>
        <dutyName>서울대학교병원</dutyName>
        <hvec>5</hvec>
        <hvoc>2</hvoc>
        <hvcc>1</hvcc>
        <hvncc>0</hvncc>
      </item>
    </items>
  </body>
</response>
"""

MOCK_HOSPITAL_XML = """<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>00</resultCode>
    <resultMsg>NORMAL SERVICE.</resultMsg>
  </header>
  <body>
    <items>
      <item>
        <dutyName>바른내과의원</dutyName>
        <dutyDivName>의원</dutyDivName>
        <dutyAddr>서울특별시 강남구 테헤란로 123</dutyAddr>
        <dutyTel1>02-555-1234</dutyTel1>
        <distance>0.35</distance>
        <wgs84Lon>127.031</wgs84Lon>
        <wgs84Lat>37.498</wgs84Lat>
        <startTime>0900</startTime>
        <endTime>1800</endTime>
      </item>
    </items>
    <numOfRows>10</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>1</totalCount>
  </body>
</response>
"""


def test_optional_text_normalizes_numeric_public_data_values() -> None:
    from app.services.medical_facility_client import _optional_text

    assert _optional_text(18005173) == "18005173"
    assert _optional_text(" 02-555-1234 ") == "02-555-1234"
    assert _optional_text("") is None


MOCK_PHARMACY_XML = """<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>00</resultCode>
    <resultMsg>NORMAL SERVICE.</resultMsg>
  </header>
  <body>
    <items>
      <item>
        <dutyName>온누리약국</dutyName>
        <dutyAddr>서울특별시 종로구 대학로 100</dutyAddr>
        <dutyTel1>02-765-4321</dutyTel1>
        <distance>0.25</distance>
        <wgs84Lat>37.5790</wgs84Lat>
        <wgs84Lon>126.9980</wgs84Lon>
        <startTime>0900</startTime>
        <endTime>1900</endTime>
      </item>
    </items>
    <numOfRows>10</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>1</totalCount>
  </body>
</response>
"""


@pytest.mark.asyncio
async def test_search_nearby_emergency_room_by_coords() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        if "getEgytLcinfoInqire" in url_str:
            return httpx.Response(200, text=MOCK_EMERGENCY_LCINFO_XML)
        if "getEmrrmRltmUsefulSckbdInfoInqire" in url_str:
            return httpx.Response(200, text=MOCK_EMERGENCY_BEDS_XML)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            emergency_api_key="test_em_key",
            hospital_api_key="test_hosp_key",
            pharmacy_api_key="test_pharm_key",
            http_client=http_client,
        )
        result = await client.search_nearby_emergency_room(latitude=37.5796, longitude=126.9989)

        assert result.search_type == "emergency_room"
        assert result.count == 1
        assert len(result.items) == 1
        item = result.items[0]
        assert item.name == "서울대학교병원"
        assert item.phone == "02-2072-2114"
        assert item.emergency_room_phone == "02-2072-1182"
        assert item.distance_m == 850
        assert item.available_beds is not None
        assert "5석 가용" in item.available_beds
        assert result.emergency_notice is not None
        assert "119" in result.emergency_notice


@pytest.mark.asyncio
async def test_search_nearby_hospital() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, text=MOCK_HOSPITAL_XML)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            emergency_api_key="test_em_key",
            hospital_api_key="test_hosp_key",
            pharmacy_api_key="test_pharm_key",
            http_client=http_client,
        )
        result = await client.search_nearby_hospital(latitude=37.498, longitude=127.031, radius=2000, keyword="내과")

        assert result.search_type == "hospital"
        assert result.count == 1
        item = result.items[0]
        assert item.name == "바른내과의원"
        assert item.category == "의원"
        assert item.phone == "02-555-1234"
        assert item.distance_m == 350
        assert any("HsptlAsembySearchService" in str(r.url) for r in requests)


@pytest.mark.asyncio
async def test_search_uses_kakao_place_coordinates_before_browser_location() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if "dapi.kakao.com" in str(request.url):
            assert request.url.params["query"] == "백석역"
            assert request.headers["Authorization"] == "KakaoAK test_kakao_key"
            return httpx.Response(200, json={"documents": [{"x": "126.7870", "y": "37.6430"}]})
        return httpx.Response(200, text=MOCK_HOSPITAL_XML)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            hospital_api_key="test_hosp_key",
            kakao_api_key="test_kakao_key",
            http_client=http_client,
        )
        await client.search_nearby_hospital(
            latitude=37.498,
            longitude=127.031,
            query="백석역 병원",
        )

    nmc_request = next(request for request in requests if "HsptlAsembySearchService" in str(request.url))
    assert nmc_request.url.params["WGS84_LAT"] == "37.643"
    assert nmc_request.url.params["WGS84_LON"] == "126.787"


@pytest.mark.asyncio
async def test_specific_place_uses_kakao_before_broader_hardcoded_landmark() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "dapi.kakao.com" in str(request.url):
            assert request.url.params["query"] == "운정중앙역"
            return httpx.Response(200, json={"documents": [{"x": "126.7281", "y": "37.7161"}]})
        assert request.url.params["WGS84_LAT"] == "37.7161"
        assert request.url.params["WGS84_LON"] == "126.7281"
        return httpx.Response(200, text=MOCK_HOSPITAL_XML)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            hospital_api_key="test_hosp_key",
            kakao_api_key="test_kakao_key",
            http_client=http_client,
        )
        result = await client.search_nearby_hospital(query="운정중앙역 병원")

    assert result.count == 1
    assert result.message is not None
    assert result.message.startswith("운정중앙역 인근")


@pytest.mark.asyncio
async def test_specialty_search_uses_kakao_region_for_nmc_department_filter() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "search/keyword.json" in url:
            return httpx.Response(200, json={"documents": [{"x": "126.7870", "y": "37.6430"}]})
        if "coord2regioncode.json" in url:
            return httpx.Response(
                200,
                json={
                    "documents": [
                        {
                            "region_type": "B",
                            "region_1depth_name": "경기",
                            "region_2depth_name": "고양시 일산동구",
                        }
                    ]
                },
            )
        assert "getHsptlMdcncListInfoInqire" in url
        assert request.url.params["Q0"] == "경기도"
        assert request.url.params["Q1"] == "일산동구"
        assert request.url.params["QD"] == "D010"
        return httpx.Response(200, text=MOCK_HOSPITAL_XML)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            hospital_api_key="test_hosp_key",
            kakao_api_key="test_kakao_key",
            http_client=http_client,
        )
        result = await client.search_nearby_hospital(query="백석역 산부인과")

    assert result.count == 1


@pytest.mark.asyncio
async def test_hospital_unregistered_key_returns_specific_guidance() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            text="SERVICE_KEY_IS_NOT_REGISTERED_ERROR",
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            emergency_api_key="test_em_key",
            hospital_api_key="test_hosp_key",
            pharmacy_api_key="test_pharm_key",
            http_client=http_client,
        )
        result = await client.search_nearby_hospital(latitude=37.498, longitude=127.031)

    assert result.count == 0
    assert result.message is not None


@pytest.mark.asyncio
async def test_search_nearby_pharmacy_success() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=MOCK_PHARMACY_XML)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            emergency_api_key="test_em_key",
            hospital_api_key="test_hosp_key",
            pharmacy_api_key="test_pharm_key",
            http_client=http_client,
        )
        result = await client.search_nearby_pharmacy(latitude=37.579, longitude=126.998)

        assert result.search_type == "pharmacy"
        assert result.count == 1
        item = result.items[0]
        assert item.name == "온누리약국"
        assert item.category == "약국"
        assert item.phone == "02-765-4321"
        assert item.distance_m == 250


@pytest.mark.asyncio
async def test_search_nearby_pharmacy_403_safe_fallback() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            text="<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>",
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            emergency_api_key="test_em_key",
            hospital_api_key="test_hosp_key",
            pharmacy_api_key="test_pharm_key",
            http_client=http_client,
        )
        result = await client.search_nearby_pharmacy(latitude=37.579, longitude=126.998)

        assert result.search_type == "pharmacy"
        assert result.count == 0
        assert result.message is not None
        assert "약국" in result.message


@pytest.mark.asyncio
async def test_missing_api_key_returns_guidance() -> None:
    client = MedicalFacilityClient(
        emergency_api_key="",
        hospital_api_key="",
        pharmacy_api_key="",
    )
    result = await client.search_nearby_emergency_room(latitude=37.5, longitude=127.0)
    assert result.count == 0
    assert result.message is not None
    assert "설정되지 않았습니다" in result.message


@pytest.mark.asyncio
async def test_network_timeout_returns_friendly_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("Connection timed out")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            emergency_api_key="test_em_key",
            hospital_api_key="test_hosp_key",
            pharmacy_api_key="test_pharm_key",
            http_client=http_client,
        )
        result = await client.search_nearby_hospital(latitude=37.5, longitude=127.0)
        assert result.count == 0
        assert result.message is not None
        assert "초과" in result.message or "지연" in result.message


@pytest.mark.asyncio
async def test_medical_facility_client_resolves_landmark_query() -> None:
    captured_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_urls.append(str(request.url))
        return httpx.Response(200, text=MOCK_HOSPITAL_XML)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            emergency_api_key="test_em_key",
            hospital_api_key="test_hosp_key",
            pharmacy_api_key="test_pharm_key",
            http_client=http_client,
        )
        result = await client.search_nearby_hospital(query="홍대 내과")
        assert result.count == 1
        assert len(captured_urls) > 0
        # 랜드마크 좌표 매핑을 통해 초고속 위치기반 API(WGS84) 또는 행정구역(Q0)으로 조회됨
        assert any("WGS84_LAT" in url or "Q0" in url for url in captured_urls)


def test_resolve_landmark_coordinates() -> None:
    lat, lon = MedicalFacilityClient._resolve_target_coords(None, None, "강남역 약국")
    assert lat == pytest.approx(37.4979, abs=0.001)
    assert lon == pytest.approx(127.0276, abs=0.001)

    # GPS 좌표가 우선
    lat2, lon2 = MedicalFacilityClient._resolve_target_coords(37.123, 126.456, "강남역 약국")
    assert lat2 == 37.123
    assert lon2 == 126.456

    # 25개 자치구도 좌표 매핑 지원
    lat_gn, lon_gn = MedicalFacilityClient._resolve_target_coords(None, None, "강남구")
    assert lat_gn == pytest.approx(37.5172, abs=0.001)
    assert lon_gn == pytest.approx(127.0473, abs=0.001)

    # 전국 광역시·도 및 주요 도시 좌표 매핑 지원
    lat_bs, lon_bs = MedicalFacilityClient._resolve_target_coords(None, None, "부산 약국")
    assert lat_bs == pytest.approx(35.1796, abs=0.001)
    assert lon_bs == pytest.approx(129.0756, abs=0.001)

    lat_dg, lon_dg = MedicalFacilityClient._resolve_target_coords(None, None, "대구 병원")
    assert lat_dg == pytest.approx(35.8714, abs=0.001)
    assert lon_dg == pytest.approx(128.6014, abs=0.001)

    lat_jj, lon_jj = MedicalFacilityClient._resolve_target_coords(None, None, "제주도 약국")
    assert lat_jj == pytest.approx(33.4890, abs=0.001)
    assert lon_jj == pytest.approx(126.4983, abs=0.001)


def test_parse_location_nationwide() -> None:
    assert MedicalFacilityClient._parse_location("부산 약국") == ("부산광역시", None)
    assert MedicalFacilityClient._parse_location("대구 병원") == ("대구광역시", None)
    assert MedicalFacilityClient._parse_location("제주도 약국") == ("제주특별자치도", None)
    assert MedicalFacilityClient._parse_location("수원 내과") == ("경기도", "수원시")
    assert MedicalFacilityClient._parse_location("해운대 약국") == ("부산광역시", "해운대구")
    assert MedicalFacilityClient._parse_location("대전 유성 이비인후과") == ("대전광역시", "유성구")


def test_extract_items_handles_empty_string_payload() -> None:
    """공공데이터포털은 0건일 때 items 를 빈 객체가 아니라 빈 문자열로 내려준다.

    이 값에 그대로 `.get` 을 부르면 AttributeError 가 나고, 호출부의 except 가
    정상적인 0건을 "일시적인 오류" 안내로 바꿔 버린다.
    """
    assert MedicalFacilityClient._extract_items({"response": {"body": {"items": ""}}}) == []
    assert MedicalFacilityClient._extract_items({"response": {"body": {"items": {}}}}) == []
    assert MedicalFacilityClient._extract_items({"response": {"body": ""}}) == []
    assert MedicalFacilityClient._extract_items({"response": ""}) == []
    assert MedicalFacilityClient._extract_items(None) == []
    # 정상 응답은 그대로 통과한다.
    assert MedicalFacilityClient._extract_items({"response": {"body": {"items": {"item": {"dutyName": "A"}}}}}) == [
        {"dutyName": "A"}
    ]
    assert MedicalFacilityClient._extract_items(
        {"response": {"body": {"items": {"item": [{"dutyName": "A"}, {"dutyName": "B"}]}}}}
    ) == [{"dutyName": "A"}, {"dutyName": "B"}]


@pytest.mark.asyncio
async def test_zero_results_reported_as_no_match_not_as_error() -> None:
    """0건은 오류가 아니다. error 를 채우면 화면이 '일시적인 오류' 를 띄운다."""
    empty_payload = '{"response":{"body":{"items":"","numOfRows":10,"pageNo":1,"totalCount":0}}}'

    def handler(request: httpx.Request) -> httpx.Response:
        if "dapi.kakao.com" in str(request.url):
            return httpx.Response(200, json={"documents": []})
        return httpx.Response(200, text=empty_payload)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            hospital_api_key="test_hosp_key",
            pharmacy_api_key="test_pharm_key",
            emergency_api_key="test_emer_key",
            http_client=http_client,
        )
        hospital = await client.search_nearby_hospital(query="강남역 정형외과")
        pharmacy = await client.search_nearby_pharmacy(query="강남역 약국")
        emergency = await client.search_nearby_emergency_room(latitude=37.4979, longitude=127.0276)

    for result in (hospital, pharmacy, emergency):
        assert result.total_count == 0
        assert result.error is None
        assert result.message is not None
        assert "오류" not in result.message


def test_parse_location_resolves_every_seoul_district() -> None:
    """자치구 이름을 짧게 끊거나 랜드마크에 양보하면 다른 구를 검색한다.

    두 가지가 겹쳐 있었다 — `중구` 를 `중` 으로 줄여 비교해 `중랑구` 가 중구가 되고,
    랜드마크 `동대문`(중구) 이 자치구 `동대문구` 보다 먼저 걸렸다.
    """
    for district in _SEOUL_DISTRICTS:
        assert MedicalFacilityClient._parse_location(f"{district} 병원") == ("서울특별시", district)


def test_parse_location_keeps_abbreviated_district_forms() -> None:
    """자치구를 먼저 보게 바꿔도 `구` 없는 줄임말은 그대로 통해야 한다."""
    assert MedicalFacilityClient._parse_location("강남 내과") == ("서울특별시", "강남구")
    assert MedicalFacilityClient._parse_location("홍대 약국") == ("서울특별시", "마포구")
    assert MedicalFacilityClient._parse_location("중랑 병원") == ("서울특별시", "중랑구")
    # 동대문시장·동대문역은 실제로 중구다. 자치구 `동대문구` 와 갈라져야 한다.
    assert MedicalFacilityClient._parse_location("동대문 병원") == ("서울특별시", "중구")
    assert MedicalFacilityClient._parse_location("동대문구 병원") == ("서울특별시", "동대문구")


def test_location_label_does_not_shorten_district_name() -> None:
    """안내 문구의 지역 표기도 검색한 구와 같아야 한다."""
    assert MedicalFacilityClient._extract_location_label(None, "중랑구") == "중랑구"
    assert MedicalFacilityClient._extract_location_label(None, "동대문구") == "동대문구"
    assert MedicalFacilityClient._extract_location_label(None, "중구") == "중구"


def test_match_department_prefers_longest_name() -> None:
    """'정형외과'가 일반 '외과'(D005)로 접히면 다른 과의 병원이 나온다."""
    assert MedicalFacilityClient._match_department("정형외과", None) == ("정형외과", "D006")
    assert MedicalFacilityClient._match_department("신경외과", None) == ("신경외과", "D007")
    assert MedicalFacilityClient._match_department("성형외과", None) == ("성형외과", "D009")
    assert MedicalFacilityClient._match_department("흉부외과", None) == ("흉부외과", "D008")
    assert MedicalFacilityClient._match_department("심장혈관흉부외과", None) == ("심장혈관흉부외과", "D008")
    assert MedicalFacilityClient._match_department("강남역 정형외과 찾아줘", None) == ("정형외과", "D006")
    # 짧은 이름 자체는 그대로 남는다.
    assert MedicalFacilityClient._match_department("외과", None) == ("외과", "D005")
    assert MedicalFacilityClient._match_department("일반외과", None) == ("외과", "D005")
    assert MedicalFacilityClient._match_department("동네 병원", None) == (None, None)


def test_match_department_keeps_region_label_intact() -> None:
    """과목명을 짧게 끊으면 남은 글자가 지명으로 새어 들어간다."""
    assert MedicalFacilityClient._extract_place_query("강남역 정형외과 찾아줘") == "강남역"
    assert MedicalFacilityClient._extract_location_label("강남역 정형외과", None) == "강남역"
    assert MedicalFacilityClient._extract_place_query("흉부외과") is None


@pytest.mark.asyncio
async def test_orthopedics_query_uses_its_own_department_code() -> None:
    """'정형외과'는 D006 으로 조회한다. D005 로 나가면 일반외과 병원이 돌아온다."""
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "search/keyword.json" in url:
            return httpx.Response(200, json={"documents": [{"x": "127.0276", "y": "37.4979"}]})
        if "coord2regioncode.json" in url:
            return httpx.Response(
                200,
                json={
                    "documents": [
                        {
                            "region_type": "B",
                            "region_1depth_name": "서울",
                            "region_2depth_name": "강남구",
                        }
                    ]
                },
            )
        assert "getHsptlMdcncListInfoInqire" in url
        seen["QD"] = request.url.params["QD"]
        return httpx.Response(200, text=MOCK_HOSPITAL_XML)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            hospital_api_key="test_hosp_key",
            kakao_api_key="test_kakao_key",
            http_client=http_client,
        )
        result = await client.search_nearby_hospital(query="강남역 정형외과")

    assert seen["QD"] == "D006"
    assert result.message is not None
    assert "정형외과" in result.message


@pytest.mark.asyncio
async def test_pharmacy_stage_distance_sorting() -> None:
    """공공데이터가 가나다순으로 반환하더라도 거리순으로 정렬되는지 검증."""
    mock_stage_xml = """<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
  <body>
    <items>
      <item>
        <dutyName>가나다약국</dutyName>
        <dutyAddr>서울 강남구 역삼동 1</dutyAddr>
        <dutyTel1>02-111-1111</dutyTel1>
        <wgs84Lat>37.5100</wgs84Lat>
        <wgs84Lon>127.0400</wgs84Lon>
        <dutyTime1s>0900</dutyTime1s>
        <dutyTime1c>2100</dutyTime1c>
      </item>
      <item>
        <dutyName>나라약국</dutyName>
        <dutyAddr>서울 강남구 역삼동 2</dutyAddr>
        <dutyTel1>02-222-2222</dutyTel1>
        <wgs84Lat>37.4980</wgs84Lat>
        <wgs84Lon>127.0280</wgs84Lon>
        <dutyTime1s>0900</dutyTime1s>
        <dutyTime1c>2100</dutyTime1c>
      </item>
    </items>
    <numOfRows>20</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>2</totalCount>
  </body>
</response>
"""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=mock_stage_xml)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            pharmacy_api_key="test_pharm_key",
            http_client=http_client,
        )
        # 강남역 기준 검색 -> 나라약국(37.4980, 127.0280)이 강남역(37.4979, 127.0276)에서 훨씬 가까움
        result = await client.search_nearby_pharmacy(query="강남역 약국")
        assert result.count == 2
        # 가나다약국이 API에서는 먼저 왔지만, 거리순 정렬되어 나라약국이 1번째여야 함
        assert result.items[0].name == "나라약국"
        assert result.items[1].name == "가나다약국"
        assert result.items[0].distance_m is not None
        assert result.items[1].distance_m is not None
        assert result.items[0].distance_m < result.items[1].distance_m
        assert result.message is not None
        assert "강남역 인근 약국" in result.message


@pytest.mark.asyncio
async def test_hospital_distance_sorting() -> None:
    """병원 검색 결과가 공공데이터 가나다순이 아닌 거리순으로 정렬되는지 검증."""
    mock_xml = """<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
  <body>
    <items>
      <item>
        <dutyName>가나안내과의원</dutyName>
        <dutyDivName>의원</dutyDivName>
        <dutyAddr>서울 강남구 역삼동 1</dutyAddr>
        <dutyTel1>02-111-1111</dutyTel1>
        <wgs84Lat>37.5150</wgs84Lat>
        <wgs84Lon>127.0450</wgs84Lon>
        <dutyTime1s>0900</dutyTime1s>
        <dutyTime1c>1800</dutyTime1c>
      </item>
      <item>
        <dutyName>하늘내과의원</dutyName>
        <dutyDivName>의원</dutyDivName>
        <dutyAddr>서울 강남구 역삼동 2</dutyAddr>
        <dutyTel1>02-222-2222</dutyTel1>
        <wgs84Lat>37.4981</wgs84Lat>
        <wgs84Lon>127.0278</wgs84Lon>
        <dutyTime1s>0900</dutyTime1s>
        <dutyTime1c>1800</dutyTime1c>
      </item>
    </items>
    <numOfRows>20</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>2</totalCount>
  </body>
</response>
"""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=mock_xml)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            hospital_api_key="test_hosp_key",
            http_client=http_client,
        )
        # 강남역 기준 검색 -> 하늘내과의원이 훨씬 가까움
        result = await client.search_nearby_hospital(query="강남역 내과")
        assert result.count == 2
        assert result.items[0].name == "하늘내과의원"
        assert result.items[1].name == "가나안내과의원"
        assert result.items[0].distance_m is not None
        assert result.items[1].distance_m is not None
        assert result.items[0].distance_m < result.items[1].distance_m
        assert result.message is not None
        assert "강남역 인근 내과 병원" in result.message


@pytest.mark.asyncio
async def test_emergency_distance_sorting() -> None:
    """응급실 검색 결과가 가나다순이 아닌 거리순으로 정렬되는지 검증."""
    mock_xml = """<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
  <body>
    <items>
      <item>
        <dutyName>강북응급의료센터</dutyName>
        <dutyEmclsName>지역응급의료센터</dutyEmclsName>
        <dutyAddr>서울 강북구 1</dutyAddr>
        <dutyTel1>02-111-1111</dutyTel1>
        <wgs84Lat>37.6390</wgs84Lat>
        <wgs84Lon>127.0250</wgs84Lon>
      </item>
      <item>
        <dutyName>강남응급의료센터</dutyName>
        <dutyEmclsName>지역응급의료센터</dutyEmclsName>
        <dutyAddr>서울 강남구 2</dutyAddr>
        <dutyTel1>02-222-2222</dutyTel1>
        <wgs84Lat>37.4985</wgs84Lat>
        <wgs84Lon>127.0285</wgs84Lon>
      </item>
    </items>
    <numOfRows>20</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>2</totalCount>
  </body>
</response>
"""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=mock_xml)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        client = MedicalFacilityClient(
            emergency_api_key="test_em_key",
            http_client=http_client,
        )
        # 강남역 기준 검색 -> 강남응급의료센터가 더 가까움
        result = await client.search_nearby_emergency_room(query="강남역 응급실")
        assert result.count == 2
        assert result.items[0].name == "강남응급의료센터"
        assert result.items[1].name == "강북응급의료센터"
        assert result.items[0].distance_m is not None
        assert result.items[1].distance_m is not None
        assert result.items[0].distance_m < result.items[1].distance_m
        assert result.message is not None
        assert "강남역 인근 응급의료기관" in result.message
