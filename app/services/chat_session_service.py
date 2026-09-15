import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import Depends
from pydantic import BaseModel

from app.core.db.session import SessionDep
from app.dtos.health_assistant import ChatMessage
from app.exceptions import ChatSessionNotFoundError
from app.integrations.llm.chain import shared_chat_client
from app.models.chat_sessions import ChatMessageRecord, ChatSession
from app.models.service_accounts import ServiceAccount
from app.repositories.chat_session_repository import ChatSessionRepository


def get_chat_session_repository(session: SessionDep) -> ChatSessionRepository:
    return ChatSessionRepository(session)


class ChatSessionService:
    def __init__(
        self,
        session: SessionDep,
        chat_session_repo: Annotated[ChatSessionRepository, Depends(get_chat_session_repository)],
    ) -> None:
        self.session = session
        self.chat_session_repo = chat_session_repo

    async def create_session(
        self,
        account: ServiceAccount,
        profile_id: str,
        title: str | None = None,
    ) -> ChatSession:
        session_obj = ChatSession(
            account_id=account.id,
            profile_id=profile_id,
            title=title,
        )
        created = await self.chat_session_repo.create_session(session_obj)
        await self.session.commit()
        return created

    async def get_session(
        self,
        account: ServiceAccount,
        session_id: uuid.UUID,
    ) -> ChatSession:
        session_obj = await self.chat_session_repo.get_session(session_id, account.id)
        if session_obj is None:
            raise ChatSessionNotFoundError()
        return session_obj

    async def list_sessions(
        self,
        account: ServiceAccount,
        profile_id: str | None = None,
        limit: int = 50,
    ) -> list[ChatSession]:
        return await self.chat_session_repo.list_sessions(account.id, profile_id=profile_id, limit=limit)

    async def delete_session(
        self,
        account: ServiceAccount,
        session_id: uuid.UUID,
    ) -> None:
        deleted = await self.chat_session_repo.soft_delete_session(session_id, account.id)
        if not deleted:
            raise ChatSessionNotFoundError()
        await self.session.commit()

    async def update_session_title(
        self,
        account: ServiceAccount,
        session_id: uuid.UUID,
        title: str,
    ) -> ChatSession:
        updated = await self.chat_session_repo.update_session_title(session_id, account.id, title)
        if not updated:
            raise ChatSessionNotFoundError()
        await self.session.commit()
        return await self.get_session(account, session_id)

    async def list_messages(
        self,
        account: ServiceAccount,
        session_id: uuid.UUID,
        limit: int = 100,
        since: datetime | None = None,
    ) -> list[ChatMessageRecord]:
        # 세션 소유권 및 삭제 여부 검증
        await self.get_session(account, session_id)
        return await self.chat_session_repo.list_messages(session_id, limit=limit, since=since)

    async def add_message(
        self,
        account: ServiceAccount,
        session_id: uuid.UUID,
        role: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> ChatMessageRecord:
        session_obj = await self.get_session(account, session_id)
        seq = await self.chat_session_repo.get_next_sequence_number(session_id)
        msg = ChatMessageRecord(
            session_id=session_id,
            role=role,
            content=content,
            metadata_=metadata,
            sequence_number=seq,
        )
        created = await self.chat_session_repo.add_message(msg)
        if session_obj.title is None and role == "user":
            session_obj.title = content[:50].strip()
            self.session.add(session_obj)
        await self.session.commit()

        if created.sequence_number > 0 and created.sequence_number % 10 == 0:
            await self._update_core_memory(session_obj)

        return created

    async def _update_core_memory(self, session_obj: ChatSession) -> None:
        """최근 메시지와 기존 기억을 바탕으로 핵심 기억을 누적 갱신한다."""
        messages_obj = await self.chat_session_repo.list_messages(session_obj.id, limit=10)
        messages_obj = await self.chat_session_repo.list_messages(session_obj.id, limit=10)
        if not messages_obj:
            return


        recent_text = "\n".join([f"{m.role}: {m.content}" for m in messages_obj])
        existing_memory = session_obj.core_memory or "없음"


        prompt = f"""
당신은 건강 어시스턴트의 장기 기억 요약기입니다.
다음은 사용자의 기존 장기 기억(핵심 건강 정보)과 최근 대화 내역입니다.

[기존 기억]
{existing_memory}

[최근 대화]
{recent_text}

지시사항:
- 기존 기억과 최근 대화를 합쳐서, 챗봇이 반드시 기억해야 할 사용자의 핵심 건강 상태, 질환, 관심사, 특이사항을 누적 요약하세요.
- 불필요한 일상 대화나 인사말은 버리고 핵심만 짧은 3~4문장 줄글로 압축하세요.
- 출력 형식은 요약된 텍스트 자체여야 합니다.
"""

        class SummarySchema(BaseModel):
            summary: str

        try:
            res = await shared_chat_client().generate_structured_response(
                system_instruction="당신은 요약 어시스턴트입니다.",
                messages=[ChatMessage(role="user", content=prompt)],
                response_schema=SummarySchema,
            )
            session_obj.core_memory = res.summary
            self.session.add(session_obj)
            await self.session.commit()
        except Exception as e:
            # 요약 실패 시 조용히 넘어간다.
            import logging

            logging.getLogger(__name__).warning("핵심 기억 요약 실패: %s", e)
