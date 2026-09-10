import uuid
from uuid import uuid4

from httpx import ASGITransport, AsyncClient
from starlette import status

from app.core import config
from app.dtos.health_assistant import HealthAssistantScopeDecision
from app.main import app
from app.services.health_assistant_boundary import SERVICE_USAGE_MESSAGE
from app.tests.conftest import TEST_BASE_URL


class TestChatSessionsApi:
    async def test_create_and_get_chat_session(self, authorized_client: AsyncClient) -> None:
        create_res = await authorized_client.post(
            "/api/v1/chat-sessions",
            json={"profile_id": "profile-alpha", "title": "첫 대화"},
        )
        assert create_res.status_code == status.HTTP_200_OK
        body = create_res.json()
        assert body["success"] is True
        session_id = body["data"]["id"]
        assert body["data"]["profile_id"] == "profile-alpha"
        assert body["data"]["title"] == "첫 대화"

        get_res = await authorized_client.get(f"/api/v1/chat-sessions/{session_id}")
        assert get_res.status_code == status.HTTP_200_OK
        get_body = get_res.json()
        assert get_body["data"]["id"] == session_id
        assert get_body["data"]["profile_id"] == "profile-alpha"

    async def test_list_chat_sessions_filtered_by_profile(self, authorized_client: AsyncClient) -> None:
        unique_prof_1 = f"prof-1-{uuid4().hex[:6]}"
        unique_prof_2 = f"prof-2-{uuid4().hex[:6]}"

        await authorized_client.post(
            "/api/v1/chat-sessions",
            json={"profile_id": unique_prof_1, "title": "프로필1 대화"},
        )
        await authorized_client.post(
            "/api/v1/chat-sessions",
            json={"profile_id": unique_prof_2, "title": "프로필2 대화"},
        )

        list_res_1 = await authorized_client.get(f"/api/v1/chat-sessions?profile_id={unique_prof_1}")
        assert list_res_1.status_code == status.HTTP_200_OK
        items_1 = list_res_1.json()["data"]["items"]
        assert len(items_1) == 1
        assert items_1[0]["profile_id"] == unique_prof_1

        list_res_2 = await authorized_client.get(f"/api/v1/chat-sessions?profile_id={unique_prof_2}")
        assert list_res_2.status_code == status.HTTP_200_OK
        items_2 = list_res_2.json()["data"]["items"]
        assert len(items_2) == 1
        assert items_2[0]["profile_id"] == unique_prof_2

    async def test_soft_delete_chat_session(self, authorized_client: AsyncClient) -> None:
        create_res = await authorized_client.post(
            "/api/v1/chat-sessions",
            json={"profile_id": "profile-del", "title": "삭제 대상 세션"},
        )
        session_id = create_res.json()["data"]["id"]

        del_res = await authorized_client.delete(f"/api/v1/chat-sessions/{session_id}")
        assert del_res.status_code == status.HTTP_200_OK

        get_res = await authorized_client.get(f"/api/v1/chat-sessions/{session_id}")
        assert get_res.status_code == status.HTTP_404_NOT_FOUND
        assert get_res.json()["error_code"] == "CHAT_SESSION_NOT_FOUND"

    async def test_update_chat_session_title(self, authorized_client: AsyncClient) -> None:
        create_res = await authorized_client.post(
            "/api/v1/chat-sessions",
            json={"profile_id": "profile-update", "title": "수정 전 제목"},
        )
        session_id = create_res.json()["data"]["id"]

        patch_res = await authorized_client.patch(
            f"/api/v1/chat-sessions/{session_id}",
            json={"title": "수정 후 새로운 제목"},
        )
        assert patch_res.status_code == status.HTTP_200_OK
        patch_body = patch_res.json()
        assert patch_body["success"] is True
        assert patch_body["data"]["title"] == "수정 후 새로운 제목"

        get_res = await authorized_client.get(f"/api/v1/chat-sessions/{session_id}")
        assert get_res.status_code == status.HTTP_200_OK
        assert get_res.json()["data"]["title"] == "수정 후 새로운 제목"

    async def test_messages_sequence_and_history(self, authorized_client: AsyncClient) -> None:
        create_res = await authorized_client.post(
            "/api/v1/chat-sessions",
            json={"profile_id": "profile-msg", "title": "메시지 테스트"},
        )
        session_id = create_res.json()["data"]["id"]

        msg1 = await authorized_client.post(
            f"/api/v1/chat-sessions/{session_id}/messages",
            json={"role": "user", "content": "안녕하세요 봄이님"},
        )
        assert msg1.status_code == status.HTTP_200_OK
        assert msg1.json()["data"]["sequence_number"] == 1

        # **구조화 metadata 는 서버만 쓴다.** 이 단정이 지키는 것은 역할이 아니라
        # metadata 다 — `extra="forbid"` 가 막는다. 예전에는 이 요청이 `role`
        # 때문에 막히는 줄로 읽혔는데, metadata 를 빼면 통과했다.
        spoofed_metadata = await authorized_client.post(
            f"/api/v1/chat-sessions/{session_id}/messages",
            json={
                "role": "assistant",
                "content": "안녕하세요! 무엇을 도와드릴까요?",
                "metadata": {"intent": "general_chat"},
            },
        )
        assert spoofed_metadata.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

        # 어시스턴트 줄 자체는 받는다. 서류를 확정 저장하는 경로는 LLM 을 거치지 않고
        # 확인 문장을 그 자리에서 만들기 때문에, 이 길이 막히면 그 대화가 반쪽만 남는다.
        assistant_turn = await authorized_client.post(
            f"/api/v1/chat-sessions/{session_id}/messages",
            json={"role": "assistant", "content": "건강검진 결과를 저장했습니다."},
        )
        assert assistant_turn.status_code == status.HTTP_200_OK
        assert assistant_turn.json()["data"]["sequence_number"] == 2

        list_res = await authorized_client.get(f"/api/v1/chat-sessions/{session_id}/messages")
        assert list_res.status_code == status.HTTP_200_OK
        items = list_res.json()["data"]["items"]
        assert len(items) == 2
        assert [item["role"] for item in items] == ["user", "assistant"]

        # 제목은 첫 **사용자** 줄에서만 온다. 어시스턴트 줄이 제목을 덮지 않는다.
        titled = await authorized_client.get(f"/api/v1/chat-sessions/{session_id}")
        assert titled.json()["data"]["title"] == "메시지 테스트"

        for content in ("두 번째 질문", "세 번째 질문"):
            added = await authorized_client.post(
                f"/api/v1/chat-sessions/{session_id}/messages",
                json={"role": "user", "content": content},
            )
            assert added.status_code == status.HTTP_200_OK

        latest_res = await authorized_client.get(f"/api/v1/chat-sessions/{session_id}/messages?limit=2")
        latest_items = latest_res.json()["data"]["items"]
        assert [item["sequence_number"] for item in latest_items] == [3, 4]
        assert [item["content"] for item in latest_items] == ["두 번째 질문", "세 번째 질문"]

    async def test_cross_account_isolation(self, authorized_client: AsyncClient) -> None:
        create_res = await authorized_client.post(
            "/api/v1/chat-sessions",
            json={"profile_id": "profile-secret", "title": "비밀 대화"},
        )
        session_id = create_res.json()["data"]["id"]

        # 다른 계정 생성 및 로그인
        other_email = f"other-{uuid4().hex}@example.com"
        other_pw = "Password123!"
        async with AsyncClient(transport=ASGITransport(app=app), base_url=TEST_BASE_URL) as other_client:
            await other_client.post("/api/v1/auth/signup", json={"email": other_email, "password": other_pw})
            login_res = await other_client.post("/api/v1/auth/login", json={"email": other_email, "password": other_pw})
            token = login_res.json()["data"]["access_token"]
            other_client.headers["Authorization"] = f"Bearer {token}"

            # 다른 사용자가 해당 세션에 접근 시도 -> 404로 보호되어야 함
            get_res = await other_client.get(f"/api/v1/chat-sessions/{session_id}")
            assert get_res.status_code == status.HTTP_404_NOT_FOUND
            assert get_res.json()["error_code"] == "CHAT_SESSION_NOT_FOUND"

            del_res = await other_client.delete(f"/api/v1/chat-sessions/{session_id}")
            assert del_res.status_code == status.HTTP_404_NOT_FOUND

    async def test_health_assistant_chat_persists_turn(self, authorized_client: AsyncClient, monkeypatch) -> None:
        fake_json = """{
            "intent": "general_chat",
            "assistant_message": "안녕하세요! 건강 관리를 도와드릴게요.",
            "exercise_draft": null,
            "blood_pressure_draft": null,
            "blood_glucose_draft": null,
            "medication_draft": null,
            "pain_draft": null,
            "query_draft": null,
            "missing_fields": [],
            "needs_confirmation": false,
            "suggested_quick_replies": ["오늘 혈압 기록할래"],
            "emergency_notice": null,
            "safety_disclaimer": null
        }"""

        class FakeResponse:
            text = fake_json

        class FakeModels:
            async def generate_content(self, *args, **kwargs):
                if kwargs["config"].response_schema is HealthAssistantScopeDecision:
                    return type(
                        "ScopeResponse",
                        (),
                        {"text": '{"scope":"service_usage","requires_authoritative_evidence":false}'},
                    )()
                return FakeResponse()

        class FakeAio:
            def __init__(self):
                self.models = FakeModels()

        class FakeClient:
            def __init__(self, *args, **kwargs):
                self.aio = FakeAio()

        import google.genai as genai

        import app.integrations.llm.chain as chain

        monkeypatch.setattr(chain, "_shared", None)
        monkeypatch.setattr(genai, "Client", FakeClient)
        monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_gemini_key")

        # 세션 생성
        create_res = await authorized_client.post(
            "/api/v1/chat-sessions",
            json={"profile_id": "profile-turn", "title": "자동 저장 대화"},
        )
        session_id = create_res.json()["data"]["id"]

        # session_id 포함하여 대화 전송
        chat_res = await authorized_client.post(
            "/api/v1/health-assistant/chat",
            json={
                "session_id": session_id,
                "messages": [{"role": "user", "content": "봄이야 안녕"}],
            },
        )
        assert chat_res.status_code == status.HTTP_200_OK

        # DB 메시지 이력에 user와 assistant 턴이 모두 저장되었는지 확인
        list_res = await authorized_client.get(f"/api/v1/chat-sessions/{session_id}/messages")
        assert list_res.status_code == status.HTTP_200_OK
        messages = list_res.json()["data"]["items"]
        assert len(messages) == 2
        assert messages[0]["role"] == "user"
        assert messages[0]["content"] == "봄이야 안녕"
        assert messages[0]["sequence_number"] == 1

        assert messages[1]["role"] == "assistant"
        assert messages[1]["content"] == SERVICE_USAGE_MESSAGE
        assert messages[1]["sequence_number"] == 2
        assert messages[1]["metadata"]["intent"] == "general_chat"

    async def test_health_assistant_chat_invalid_session_returns_404(self, authorized_client: AsyncClient) -> None:
        random_id = str(uuid.uuid4())
        chat_res = await authorized_client.post(
            "/api/v1/health-assistant/chat",
            json={
                "session_id": random_id,
                "messages": [{"role": "user", "content": "봄이야 안녕"}],
            },
        )
        assert chat_res.status_code == status.HTTP_404_NOT_FOUND
        assert chat_res.json()["error_code"] == "CHAT_SESSION_NOT_FOUND"
