from typing import Protocol, TypeVar
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class LLMClientProtocol(Protocol):
    async def generate_structured_response(
        self,
        system_instruction: str,
        messages: list[str],
        response_schema: type[T],
    ) -> T:
        ...

