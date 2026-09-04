import uuid
from typing import Annotated, Any

from fastapi import Depends

from app.core.db.session import SessionDep
from app.exceptions import ChatSessionNotFoundError
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

    async def list_messages(
        self,
        account: ServiceAccount,
        session_id: uuid.UUID,
        limit: int = 100,
    ) -> list[ChatMessageRecord]:
        # 세션 소유권 및 삭제 여부 검증
        await self.get_session(account, session_id)
        return await self.chat_session_repo.list_messages(session_id, limit=limit)

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
        return created
