from typing import Annotated

from fastapi import APIRouter, Depends

from app.dtos.envelope import ApiResponse
from app.dtos.health_assistant import (
    HealthAssistantChatRequest,
    HealthAssistantResponse,
)
from app.services.health_assistant import HealthAssistantService

health_assistant_router = APIRouter(prefix="/health-assistant", tags=["health-assistant"])


def get_health_assistant_service() -> HealthAssistantService:
    return HealthAssistantService()

@health_assistant_router.post(
    "/chat",
    response_model=ApiResponse[HealthAssistantResponse],
    summary="통합 건강 어시스턴트(봄이) 자연어 대화 및 기록 초안 추출",
)
async def chat_with_assistant(
    request: HealthAssistantChatRequest,
    service: Annotated[HealthAssistantService, Depends(get_health_assistant_service)],
) -> ApiResponse[HealthAssistantResponse]:
    data = await service.respond(request)
    return ApiResponse(data=data, message="건강 어시스턴트 응답을 처리했습니다.")

