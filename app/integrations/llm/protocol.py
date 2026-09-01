from typing import Protocol, TypeVar

from pydantic import BaseModel

from app.dtos.health_assistant import ChatMessage

T = TypeVar("T", bound=BaseModel)


class LLMClientProtocol(Protocol):
    async def generate_structured_response(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
    ) -> T:
        ...
