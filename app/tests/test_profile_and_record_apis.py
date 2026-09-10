import uuid
from datetime import datetime, timezone

from httpx import AsyncClient
from starlette import status


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    await client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


async def _create_household(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post("/api/v1/households", headers=headers)
    assert response.status_code == status.HTTP_201_CREATED
    return response.json()["data"]["id"]


class TestProfileAndRecordAPIs:
    async def test_profile_crud_and_sync(self, client: AsyncClient) -> None:
        user_headers = await _login(client, "profile-crud@example.com")
        household_id = await _create_household(client, user_headers)

        # 1. 프로필 생성
        create_res = await client.post(
            "/api/v1/profiles",
            headers=user_headers,
            json={
                "household_id": household_id,
                "display_name": "홍길동",
                "relationship": "self",
                "birth_date": "1990-01-01",
                "gender": "male",
            },
        )
        assert create_res.status_code == status.HTTP_201_CREATED
        profile = create_res.json()["data"]
        profile_id = profile["id"]
        assert profile["display_name"] == "홍길동"
        assert profile["gender"] == "male"
        assert profile["row_version"] == 1

        # 2. 목록 조회
        list_res = await client.get(
            f"/api/v1/profiles?household_id={household_id}",
            headers=user_headers,
        )
        assert list_res.status_code == status.HTTP_200_OK
        items = list_res.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["id"] == profile_id

        # 3. 단일 조회
        get_res = await client.get(f"/api/v1/profiles/{profile_id}", headers=user_headers)
        assert get_res.status_code == status.HTTP_200_OK
        assert get_res.json()["data"]["id"] == profile_id

        # 4. 수정
        update_res = await client.patch(
            f"/api/v1/profiles/{profile_id}",
            headers=user_headers,
            json={"display_name": "홍길동(수정)", "gender": "female"},
        )
        assert update_res.status_code == status.HTTP_200_OK
        updated = update_res.json()["data"]
        assert updated["display_name"] == "홍길동(수정)"
        assert updated["gender"] == "female"
        assert updated["row_version"] == 2

        # 5. 동기화 (sync)
        sync_res = await client.post(
            "/api/v1/profiles/sync",
            headers=user_headers,
            json={
                "profiles": [
                    {
                        "id": profile_id,
                        "household_id": household_id,
                        "display_name": "홍길동(싱크)",
                        "relationship": "self",
                        "birth_date": "1990-01-01",
                        "gender": "male",
                        "row_version": 3,
                    },
                    {
                        "id": str(uuid.uuid4()),
                        "household_id": household_id,
                        "display_name": "가족2",
                        "relationship": "child",
                        "birth_date": "2020-05-05",
                        "gender": "female",
                        "row_version": 1,
                    },
                ]
            },
        )
        assert sync_res.status_code == status.HTTP_200_OK
        synced_items = sync_res.json()["data"]["items"]
        assert len(synced_items) == 2

        # 6. 삭제 (soft-delete)
        delete_res = await client.delete(f"/api/v1/profiles/{profile_id}", headers=user_headers)
        assert delete_res.status_code == status.HTTP_200_OK
        # 삭제 후 일반 목록에서는 제외됨
        active_list = await client.get(
            f"/api/v1/profiles?household_id={household_id}",
            headers=user_headers,
        )
        assert len(active_list.json()["data"]["items"]) == 1

    async def test_health_record_crud_and_sync(self, client: AsyncClient) -> None:
        user_headers = await _login(client, "record-crud@example.com")
        household_id = await _create_household(client, user_headers)

        profile_res = await client.post(
            "/api/v1/profiles",
            headers=user_headers,
            json={
                "household_id": household_id,
                "display_name": "기록테스트",
                "relationship": "self",
            },
        )
        profile_id = profile_res.json()["data"]["id"]

        # 1. 기록 생성
        now_str = datetime.now(timezone.utc).isoformat()
        rec_res = await client.post(
            "/api/v1/health-records",
            headers=user_headers,
            json={
                "profile_id": profile_id,
                "record_type": "blood_pressure",
                "recorded_at": now_str,
                "source": "manual",
                "payload": {"systolic": 120, "diastolic": 80},
            },
        )
        assert rec_res.status_code == status.HTTP_201_CREATED
        record = rec_res.json()["data"]
        record_id = record["id"]
        assert record["record_type"] == "blood_pressure"
        assert record["payload"]["systolic"] == 120

        # 2. 목록 조회
        list_res = await client.get(
            f"/api/v1/health-records?profile_id={profile_id}",
            headers=user_headers,
        )
        assert list_res.status_code == status.HTTP_200_OK
        items = list_res.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["id"] == record_id

        # 3. 수정
        update_res = await client.patch(
            f"/api/v1/health-records/{record_id}",
            headers=user_headers,
            json={"payload": {"systolic": 125, "diastolic": 82}},
        )
        assert update_res.status_code == status.HTTP_200_OK
        assert update_res.json()["data"]["payload"]["systolic"] == 125

        # 4. 삭제
        del_res = await client.delete(f"/api/v1/health-records/{record_id}", headers=user_headers)
        assert del_res.status_code == status.HTTP_200_OK
        # 단일 조회 시 404
        get_res = await client.get(f"/api/v1/health-records/{record_id}", headers=user_headers)
        assert get_res.status_code == status.HTTP_404_NOT_FOUND

    async def test_source_document_id_survives_the_round_trip(self, client: AsyncClient) -> None:
        """**원본 서류와 기록을 잇는 고리가 서버를 왕복하는가.**

        검진표를 올려 판정하면 원본은 기기 보관함에, 판정은 이 표에 남는다. 그 둘을
        잇는 것이 이 값 하나다. 화면은 서버에서 기록을 읽으므로, 서버가 안 들고 있으면
        건강 데이터의 검진 이력이 영원히 빈다 — 실제로 그 상태였다.
        """
        user_headers = await _login(client, "doclink@example.com")
        household_id = await _create_household(client, user_headers)
        profile_res = await client.post(
            "/api/v1/profiles",
            headers=user_headers,
            json={"household_id": household_id, "display_name": "나", "relationship": "self"},
        )
        profile_id = profile_res.json()["data"]["id"]

        created = await client.post(
            "/api/v1/health-records",
            headers=user_headers,
            json={
                "profile_id": profile_id,
                "record_type": "assessment",
                "recorded_at": "2026-09-08T00:00:00Z",
                "source": "ocr",
                "payload": {"inputs": {"sbp": 132}},
                "source_document_id": "doc-abc-123",
            },
        )
        assert created.status_code == status.HTTP_201_CREATED, created.text
        assert created.json()["data"]["source_document_id"] == "doc-abc-123"

        # 다시 읽어도 남아 있어야 한다. 응답에서만 되비치고 저장이 안 되면 새로고침
        # 한 번에 사라진다.
        listed = await client.get(
            f"/api/v1/health-records?profile_id={profile_id}",
            headers=user_headers,
        )
        assert listed.json()["data"]["items"][0]["source_document_id"] == "doc-abc-123"

    async def test_access_denied_for_other_household(self, client: AsyncClient) -> None:
        user_a = await _login(client, "user-a@example.com")
        user_b = await _login(client, "user-b@example.com")
        household_a = await _create_household(client, user_a)

        # user_b가 user_a의 가정에 프로필 생성 시도 -> 403 or 404
        create_res = await client.post(
            "/api/v1/profiles",
            headers=user_b,
            json={
                "household_id": household_a,
                "display_name": "침입자",
                "relationship": "other",
            },
        )
        assert create_res.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)

    async def test_health_record_anatomy_event_validation(self, client: AsyncClient) -> None:
        """P0-7: 3D 해부학 이벤트가 포함된 건강기록 저장 시 계약 유효성을 검증한다."""
        user = await _login(client, "anatomy-record-user@example.com")
        household_id = await _create_household(client, user)
        profile_res = await client.post(
            "/api/v1/profiles",
            headers=user,
            json={"household_id": household_id, "display_name": "환자", "relationship": "self"},
        )
        profile_id = profile_res.json()["data"]["id"]

        # 1. 무효한 anatomyEvent (필수 필드 누락 등) 저장 시도 -> 422 또는 400 거부
        invalid_res = await client.post(
            "/api/v1/health-records",
            headers=user,
            json={
                "profile_id": profile_id,
                "record_type": "pain",
                "recorded_at": "2026-09-10T10:00:00Z",
                "source": "self_report",
                "payload": {
                    "anatomyEvent": {
                        "schemaVersion": "invalid_version",
                        "concept": {"canonicalConceptId": "foo"},
                    }
                },
            },
        )
        assert invalid_res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

        # 2. 유효한 표준 anatomyEvent 저장 -> 성공
        valid_anatomy_event = {
            "schemaVersion": "1.0.0",
            "eventId": "evt-valid-101",
            "atlas": {
                "id": "male-standard",
                "version": "1.0",
                "referenceSex": "male",
            },
            "concept": {
                "canonicalConceptId": "fma:67890",
                "sourceKey": "mesh_trapezius_l",
                "sourceMeshId": "mesh_trapezius_l",
                "label": "승모근",
                "system": "근육계",
                "side": "left",
                "mappingStatus": "canonical",
            },
            "geometry": {
                "coordinateSpace": "world",
                "point": [0.1, 1.4, -0.05],
            },
            "inputSource": "tap",
            "state": "confirmed",
            "recordedAt": "2026-09-10T10:00:00Z",
        }

        valid_res = await client.post(
            "/api/v1/health-records",
            headers=user,
            json={
                "profile_id": profile_id,
                "record_type": "pain",
                "recorded_at": "2026-09-10T10:00:00Z",
                "source": "self_report",
                "payload": {
                    "sensation": "뻐근함",
                    "anatomyEvent": valid_anatomy_event,
                },
            },
        )
        assert valid_res.status_code == status.HTTP_201_CREATED, valid_res.text
        created_record = valid_res.json()["data"]
        assert created_record["payload"]["anatomyEvent"]["concept"]["canonicalConceptId"] == "fma:67890"
        assert created_record["payload"]["anatomyEvent"]["concept"]["side"] == "left"
