from typing import Annotated

from fastapi import APIRouter, Depends

from app.dtos.envelope import ApiResponse
from app.dtos.pain_chat import PainChatData, PainChatRequest
from app.services.pain_chat import PainChatService

pain_chat_router = APIRouter(prefix="/pain-chat", tags=["pain-chat"])


@pain_chat_router.post("/messages", response_model=ApiResponse[PainChatData], summary="대화형 통증 기록 정보 추출")
async def send_pain_message(
    request: PainChatRequest, service: Annotated[PainChatService, Depends(PainChatService)]
) -> ApiResponse[PainChatData]:
    return ApiResponse(data=await service.respond(request.messages), message="통증 기록 초안을 업데이트했습니다.")
