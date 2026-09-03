from collections.abc import AsyncIterator
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
    ) -> T: ...

    def stream_structured_response(
        self,
        system_instruction: str,
        messages: list[ChatMessage],
        response_schema: type[T],
    ) -> AsyncIterator[str]:
        """구조화 JSON 을 **조각으로** 흘린다. 조각은 원본 JSON 문자열이다.

        해독은 호출부가 한다(`PartialJsonTextReader`) — 어느 필드를 화면에 흘릴지는
        공급자가 알 일이 아니고, 같은 조각에서 뽑을 것이 화면마다 다를 수 있다.
        """
        ...
