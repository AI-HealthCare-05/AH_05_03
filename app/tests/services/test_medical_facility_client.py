import httpx
import pytest

from app.services.medical_facility_client import MedicalFacilityClient

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
        <yadmNm>바른내과의원</yadmNm>
        <clCdNm>의원</clCdNm>
        <addr>서울특별시 강남구 테헤란로 123</addr>
        <telno>02-555-1234</telno>
        <distance>350.2</distance>
        <XPos>127.031</XPos>
        <YPos>37.498</YPos>
      </item>
    </items>
    <numOfRows>10</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>1</totalCount>
  </body>
</response>
"""

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
        <dutyTime1s>0900</dutyTime1s>
        <dutyTime1c>1900</dutyTime1c>
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
    def handler(request: httpx.Request) -> httpx.Response:
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
