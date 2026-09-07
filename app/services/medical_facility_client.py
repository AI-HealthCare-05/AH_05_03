"""공공데이터포털(data.go.kr) 기반 의료시설(응급실, 병원, 약국) 조회 클라이언트.

라우터가 아닌 서비스/클라이언트 계층으로 분리되어 있으며,
비동기 httpx 클라이언트를 사용하고 오류 발생 시 사용자 친화적인 메시지를 반환합니다.
API 키나 원본 응답 전체를 로그에 남기지 않습니다.
"""

from __future__ import annotations

import logging
import urllib.parse
import xml.etree.ElementTree as ET
from typing import Any

import httpx

from app.core import config
from app.dtos.medical_facility import FacilityItem, FacilitySearchResult

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 15.0
_EMERGENCY_NOTICE = (
    "응급 상황 시 지체 없이 119에 도움을 요청하시거나, "
    "출발 전 해당 응급실에 직접 전화하여 진료 및 수용 가능 여부를 반드시 확인하시기 바랍니다."
)


class MedicalFacilityClient:
    """국립중앙의료원 및 건강보험심사평가원 공공 API 클라이언트."""

    def __init__(
        self,
        emergency_api_key: str | None = None,
        hospital_api_key: str | None = None,
        pharmacy_api_key: str | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.emergency_api_key = (
            emergency_api_key if emergency_api_key is not None else config.EMERGENCY_MEDICAL_API_KEY
        )
        self.hospital_api_key = hospital_api_key if hospital_api_key is not None else config.HOSPITAL_INFO_API_KEY
        self.pharmacy_api_key = pharmacy_api_key if pharmacy_api_key is not None else config.PHARMACY_INFO_API_KEY
        self._http_client = http_client

    def _get_client(self) -> httpx.AsyncClient:
        if self._http_client is not None:
            return self._http_client
        return httpx.AsyncClient(timeout=_TIMEOUT_SECONDS)

    @staticmethod
    def _clean_key(key: str | None) -> str | None:
        if not key:
            return None
        # data.go.kr 키는 종종 URL 인코딩된 상태로 .env에 저장되므로 unquote 처리
        return urllib.parse.unquote(key.strip())

    @staticmethod
    def _parse_xml_or_json(text: str) -> dict[str, Any] | None:
        """응답 텍스트를 JSON 또는 XML로 유연하게 파싱."""
        import json

        text_stripped = text.strip()
        if text_stripped.startswith("{") or text_stripped.startswith("["):
            try:
                return json.loads(text_stripped)
            except Exception:
                pass
        # XML fallback
        if text_stripped.startswith("<"):
            try:
                root = ET.fromstring(text_stripped)

                # 간단한 dict 변환
                def elem_to_dict(elem: ET.Element) -> Any:
                    children = list(elem)
                    if not children:
                        return elem.text
                    result: dict[str, Any] = {}
                    for child in children:
                        child_val = elem_to_dict(child)
                        if child.tag in result:
                            if not isinstance(result[child.tag], list):
                                result[child.tag] = [result[child.tag]]
                            result[child.tag].append(child_val)
                        else:
                            result[child.tag] = child_val
                    return result

                return {root.tag: elem_to_dict(root)}
            except Exception as ex:
                logger.warning(f"XML 파싱 실패: {type(ex).__name__}")
                return None
        return None

    async def _fetch_emergency_by_location(
        self,
        client: httpx.AsyncClient,
        key: str,
        latitude: float,
        longitude: float,
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
            logger.warning(f"응급의료 위치 API 응답 코드: {res.status_code}")
            return []

        data = self._parse_xml_or_json(res.text)
        raw_items = self._extract_items(data)
        items: list[FacilityItem] = []
        for it in raw_items:
            name = it.get("dutyName") or it.get("dutyEmclsName") or "응급의료기관"
            dist_val = it.get("distance")
            dist_m = int(float(dist_val) * 1000) if dist_val is not None else None
            lat_val = it.get("latitude")
            lon_val = it.get("longitude")
            em_phone = it.get("dutyTel3")
            items.append(
                FacilityItem(
                    name=name,
                    category=it.get("dutyEmclsName") or it.get("dutyDivName") or "응급의료기관",
                    address=it.get("dutyAddr") or "",
                    phone=it.get("dutyTel1") or em_phone,
                    emergency_room_phone=em_phone,
                    distance_m=dist_m,
                    latitude=float(lat_val) if lat_val else None,
                    longitude=float(lon_val) if lon_val else None,
                    hpid=it.get("hpid"),
                )
            )
        return items

    async def _fetch_emergency_by_stage(
        self,
        client: httpx.AsyncClient,
        key: str,
        stage1: str | None,
        stage2: str | None,
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
            items.append(
                FacilityItem(
                    name=it.get("dutyName") or "응급의료기관",
                    category=it.get("dutyEmclsName") or it.get("dutyDivName") or "응급의료기관",
                    address=it.get("dutyAddr") or "",
                    phone=it.get("dutyTel1") or em_phone,
                    emergency_room_phone=em_phone,
                    distance_m=None,
                    latitude=float(it["wgs84Lat"]) if it.get("wgs84Lat") else None,
                    longitude=float(it["wgs84Lon"]) if it.get("wgs84Lon") else None,
                    hpid=it.get("hpid"),
                )
            )
        return items

    async def search_nearby_emergency_room(
        self,
        latitude: float | None = None,
        longitude: float | None = None,
        radius: int = 10000,
        stage1: str | None = None,
        stage2: str | None = None,
    ) -> FacilitySearchResult:
        """주변 응급실(응급의료기관) 및 실시간 가용병상 정보 조회.

        사용자 위치(위도/경도) 또는 시도/시군구 정보를 받아 조회합니다.
        """
        key = self._clean_key(self.emergency_api_key)
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
            if latitude is not None and longitude is not None:
                items = await self._fetch_emergency_by_location(client, key, latitude, longitude)

            if not items and (stage1 or stage2):
                items = await self._fetch_emergency_by_stage(client, key, stage1, stage2)

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

            return FacilitySearchResult(
                facility_type="emergency_room",
                total_count=len(items),
                items=items,
                emergency_notice=_EMERGENCY_NOTICE,
                message=f"주변 응급의료기관 {len(items)}곳을 조회했습니다.",
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

    @staticmethod
    def _deduce_stages(
        items: list[FacilityItem],
        stage1: str | None,
        stage2: str | None,
    ) -> tuple[str | None, str | None]:
        if stage1:
            return stage1, stage2
        if items and items[0].address:
            parts = items[0].address.split()
            if len(parts) >= 2:
                return parts[0], parts[1]
        return None, None

    @staticmethod
    def _build_bed_map(bed_items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        bed_map: dict[str, dict[str, Any]] = {}
        for b in bed_items:
            hpid = b.get("hpid")
            if hpid:
                bed_map[hpid] = {
                    "available_beds": b.get("hvec"),  # 일반 응급실 가용병상
                    "surgery_available": b.get("hvoc"),  # 수술실 가용여부
                    "icu_available": b.get("hvcc"),  # 중환자실
                    "pediatric_beds": b.get("hv28"),  # 소아
                    "negative_pressure_beds": b.get("hv29"),  # 음압
                }
        return bed_map

    async def _enrich_realtime_beds(
        self,
        client: httpx.AsyncClient,
        key: str,
        items: list[FacilityItem],
        stage1: str | None,
        stage2: str | None,
    ) -> None:
        """실시간 가용병상 정보 조회하여 items에 결합."""
        try:
            s1, s2 = self._deduce_stages(items, stage1, stage2)
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
            bed_map = self._build_bed_map(self._extract_items(data))

            for item in items:
                hpid = item.hpid
                if hpid and hpid in bed_map:
                    beds = bed_map[hpid].get("available_beds")
                    if beds is not None:
                        item.available_beds = f"응급실: {beds}석 가용"

        except Exception as ex:
            logger.debug(f"실시간 가용병상 조회 무시: {ex}")

    async def search_nearby_hospital(
        self,
        latitude: float,
        longitude: float,
        radius: int = 3000,
        keyword: str | None = None,
    ) -> FacilitySearchResult:
        """건강보험심사평가원 병원정보서비스를 통한 주변 병원 조회.

        xPos=경도, yPos=위도, radius=미터 기준 적용.
        """
        key = self._clean_key(self.hospital_api_key)
        if not key:
            return FacilitySearchResult(
                facility_type="hospital",
                total_count=0,
                items=[],
                error="병원정보 API 키가 설정되지 않았습니다.",
                message="병원 조회를 위한 공공데이터 API 키가 설정되지 않았습니다.",
            )

        client = self._get_client()
        try:
            # v2 getHospBasisList (v2에서 getHospBasisList1 기능 통합 운영)
            url = "https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList"
            params: dict[str, Any] = {
                "serviceKey": key,
                "xPos": str(longitude),
                "yPos": str(latitude),
                "radius": str(radius),
                "pageNo": "1",
                "numOfRows": "10",
                "_type": "json",
            }
            if keyword:
                params["yadmNm"] = keyword.strip()

            res = await client.get(url, params=params)
            # v2 실패 시 v1 fallback
            if res.status_code != 200:
                url_v1 = "https://apis.data.go.kr/B551182/hospInfoService1/getHospBasisList1"
                res = await client.get(url_v1, params=params)

            if res.status_code != 200:
                return FacilitySearchResult(
                    facility_type="hospital",
                    total_count=0,
                    items=[],
                    error=f"공공데이터 응답 코드 {res.status_code}",
                    message="병원 정보 서비스 연동 중 오류가 발생했습니다.",
                )

            data = self._parse_xml_or_json(res.text)
            raw_items = self._extract_items(data)
            items: list[FacilityItem] = []
            for it in raw_items:
                name = it.get("yadmNm") or "병원"
                cl_cd_nm = it.get("clCdNm")
                addr = it.get("addr") or ""
                phone = it.get("telno")
                hosp_url = it.get("hospUrl")
                dist_val = it.get("distance")
                dist_m = int(float(dist_val)) if dist_val is not None else None
                x_pos = it.get("XPos")
                y_pos = it.get("YPos")

                item = FacilityItem(
                    name=name,
                    category=cl_cd_nm,
                    address=addr,
                    phone=phone,
                    distance_m=dist_m,
                    latitude=float(y_pos) if y_pos else None,
                    longitude=float(x_pos) if x_pos else None,
                    homepage=hosp_url,
                    hpid=it.get("ykiho"),
                )
                items.append(item)
            items.sort(key=lambda x: x.distance_m if x.distance_m is not None else 999999)
            items = items[:5]

            if not items:
                search_desc = f"'{keyword}' 관련 " if keyword else ""
                return FacilitySearchResult(
                    facility_type="hospital",
                    total_count=0,
                    items=[],
                    message=f"반경 {radius}m 내에 {search_desc}병원이 조회되지 않았습니다.",
                )

            return FacilitySearchResult(
                facility_type="hospital",
                total_count=len(items),
                items=items,
                message=f"주변 병원 {len(items)}곳을 조회했습니다.",
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

    async def search_nearby_pharmacy(
        self,
        latitude: float,
        longitude: float,
        radius: int = 3000,
    ) -> FacilitySearchResult:
        """국립중앙의료원 전국 약국 정보 API를 통한 주변 약국 조회.

        위치 기반(경도, 위도) 조회를 수행합니다.
        """
        key = self._clean_key(self.pharmacy_api_key)
        if not key:
            return FacilitySearchResult(
                facility_type="pharmacy",
                total_count=0,
                items=[],
                error="약국정보 API 키가 설정되지 않았습니다.",
                message="약국 조회를 위한 공공데이터 API 키가 설정되지 않았습니다.",
            )

        client = self._get_client()
        try:
            url = "https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyLcinfoInqire"
            params = {
                "serviceKey": key,
                "WGS84_LON": str(longitude),
                "WGS84_LAT": str(latitude),
                "pageNo": "1",
                "numOfRows": "10",
                "_type": "json",
            }

            res = await client.get(url, params=params)

            # 포털 게이트웨이 인증 대기(403 등) 또는 서비스 오류 처리
            if res.status_code == 403 or "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" in res.text:
                logger.info("약국 API 키 인증/동기화 대기 상태 (403/미등록)")
                return FacilitySearchResult(
                    facility_type="pharmacy",
                    total_count=0,
                    items=[],
                    error="약국 API 서비스 인증 준비 중",
                    message=(
                        "공공데이터 약국 정보 서비스의 인증이 동기화 진행 중입니다. "
                        "잠시 후 다시 시도해 주시거나 가까운 병원 및 114 안내를 이용해 주세요."
                    ),
                )

            if res.status_code != 200:
                return FacilitySearchResult(
                    facility_type="pharmacy",
                    total_count=0,
                    items=[],
                    error=f"공공데이터 응답 코드 {res.status_code}",
                    message="약국 정보 서비스 연동 중 오류가 발생했습니다.",
                )

            data = self._parse_xml_or_json(res.text)
            raw_items = self._extract_items(data)
            items: list[FacilityItem] = [self._parse_pharmacy_item(it) for it in raw_items]
            items.sort(key=lambda x: x.distance_m if x.distance_m is not None else 999999)
            items = items[:5]

            if not items:
                return FacilitySearchResult(
                    facility_type="pharmacy",
                    total_count=0,
                    items=[],
                    message="반경 내에 운영 중인 약국이 조회되지 않았습니다.",
                )

            return FacilitySearchResult(
                facility_type="pharmacy",
                total_count=len(items),
                items=items,
                message=f"주변 약국 {len(items)}곳을 조회했습니다.",
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

    @staticmethod
    def _parse_pharmacy_item(it: dict[str, Any]) -> FacilityItem:
        name = it.get("dutyName") or "약국"
        addr = it.get("dutyAddr") or ""
        phone = it.get("dutyTel1")
        dist_val = it.get("distance")
        dist_m = int(float(dist_val) * 1000) if dist_val is not None else None
        lat_val = it.get("wgs84Lat")
        lon_val = it.get("wgs84Lon")

        operating_hours: dict[str, str] = {}
        days = ["월", "화", "수", "목", "금", "토", "일", "공휴일"]
        for idx, day_name in enumerate(days, start=1):
            start_k = f"dutyTime{idx}s"
            close_k = f"dutyTime{idx}c"
            if it.get(start_k) and it.get(close_k):
                s = str(it[start_k]).zfill(4)
                c = str(it[close_k]).zfill(4)
                operating_hours[day_name] = f"{s[:2]}:{s[2:]} ~ {c[:2]}:{c[2:]}"

        hours_str = ", ".join(f"{k}: {v}" for k, v in operating_hours.items()) if operating_hours else None
        return FacilityItem(
            name=name,
            category="약국",
            address=addr,
            phone=phone,
            distance_m=dist_m,
            latitude=float(lat_val) if lat_val else None,
            longitude=float(lon_val) if lon_val else None,
            operating_hours=hours_str,
            hpid=it.get("hpid"),
        )

    @staticmethod
    def _extract_items(data: dict[str, Any] | None) -> list[dict[str, Any]]:
        """data.go.kr의 다양한 response/body/items/item 구조에서 리스트 추출."""
        if not data:
            return []

        # 1. 표준 json 형태: {"response": {"body": {"items": {"item": [...]}}}}
        resp = data.get("response") or data.get("OpenAPI_ServiceResponse") or data
        if isinstance(resp, dict):
            body = resp.get("body") or resp
            if isinstance(body, dict):
                items_container = body.get("items")
                if isinstance(items_container, dict):
                    item = items_container.get("item")
                    if isinstance(item, list):
                        return item
                    if isinstance(item, dict):
                        return [item]
                elif isinstance(items_container, list):
                    return items_container
        return []
