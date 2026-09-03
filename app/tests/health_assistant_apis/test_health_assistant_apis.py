from httpx import AsyncClient
from starlette import status

from app.core import config


class TestHealthAssistantApi:
    async def test_chat_api_success_with_mocked_gemini(self, client: AsyncClient, monkeypatch) -> None:
        fake_json = """{
            "intent": "record_blood_pressure",
            "assistant_message": "혈압 120/80 mmHg로 측정 결과를 오늘 기록에 저장할까요?",
            "exercise_draft": null,
            "blood_pressure_draft": {
                "systolic": 120,
                "diastolic": 80,
                "pulse": null,
                "measured_at": null,
                "note": null
            },
            "blood_glucose_draft": null,
            "medication_draft": null,
            "pain_draft": null,
            "query_draft": null,
            "missing_fields": [],
            "needs_confirmation": true,
            "suggested_quick_replies": ["저장해줘", "수정할래"],
            "emergency_notice": null,
            "safety_disclaimer": null
        }"""

        class FakeResponse:
            text = fake_json

        class FakeModels:
            async def generate_content(self, *args, **kwargs):
                return FakeResponse()

        class FakeAio:
            def __init__(self):
                self.models = FakeModels()

        class FakeClient:
            def __init__(self, *args, **kwargs):
                self.aio = FakeAio()

        import google.genai as genai

        monkeypatch.setattr(genai, "Client", FakeClient)
        monkeypatch.setattr(config, "GEMINI_API_KEY", "fake_gemini_key")

        payload = {
            "messages": [{"role": "user", "content": "혈압 120에 80 나왔어"}],
            "profile_context": {
                "profile_name": "엄마",
                "relationship": "부모",
                "birth_year": 1960,
                "recent_records_summary": "최근 혈압: 125/82 (3일 전)",
            },
        }

        response = await client.post("/api/v1/health-assistant/chat", json=payload)
        assert response.status_code == status.HTTP_200_OK

        body = response.json()
        assert body["success"] is True
        data = body["data"]
        assert data["intent"] == "record_blood_pressure"
        assert data["blood_pressure_draft"]["systolic"] == 120
        assert data["blood_pressure_draft"]["diastolic"] == 80
        assert data["needs_confirmation"] is True
