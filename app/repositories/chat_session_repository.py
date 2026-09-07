import uuid
from datetime import datetime, timezone
from typing import Any, cast

from sqlalchemy import CursorResult, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat_sessions import ChatMessageRecord, ChatSession


class ChatSessionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_session(self, session_obj: ChatSession) -> ChatSession:
        self.session.add(session_obj)
        await self.session.flush()
        return session_obj

    async def get_session(self, session_id: uuid.UUID, account_id: uuid.UUID) -> ChatSession | None:
        return await self.session.scalar(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.account_id == account_id,
                ChatSession.deleted_at.is_(None),
            )
        )

    async def list_sessions(
        self, account_id: uuid.UUID, profile_id: str | None = None, limit: int = 50
    ) -> list[ChatSession]:
        query = select(ChatSession).where(
            ChatSession.account_id == account_id,
            ChatSession.deleted_at.is_(None),
        )
        if profile_id is not None:
            query = query.where(ChatSession.profile_id == profile_id)
        query = query.order_by(ChatSession.updated_at.desc()).limit(limit)
        result = await self.session.scalars(query)
        return list(result)

    async def soft_delete_session(self, session_id: uuid.UUID, account_id: uuid.UUID) -> bool:
        now = datetime.now(timezone.utc)
        result = cast(
            CursorResult[Any],
            await self.session.execute(
                update(ChatSession)
                .where(
                    ChatSession.id == session_id,
                    ChatSession.account_id == account_id,
                    ChatSession.deleted_at.is_(None),
                )
                .values(deleted_at=now, updated_at=now)
            ),
        )
        return bool(result.rowcount)

    async def get_next_sequence_number(self, session_id: uuid.UUID) -> int:
        # 같은 세션의 동시 요청만 직렬화해 중복 순번을 막는다.
        await self.session.scalar(select(ChatSession.id).where(ChatSession.id == session_id).with_for_update())
        query = select(func.coalesce(func.max(ChatMessageRecord.sequence_number), 0) + 1).where(
            ChatMessageRecord.session_id == session_id
        )
        seq = await self.session.scalar(query)
        return int(seq) if seq is not None else 1

    async def add_message(self, message: ChatMessageRecord) -> ChatMessageRecord:
        self.session.add(message)
        now = datetime.now(timezone.utc)
        await self.session.execute(
            update(ChatSession).where(ChatSession.id == message.session_id).values(updated_at=now)
        )
        await self.session.flush()
        return message

    async def list_messages(self, session_id: uuid.UUID, limit: int = 100) -> list[ChatMessageRecord]:
        query = (
            select(ChatMessageRecord)
            .where(ChatMessageRecord.session_id == session_id)
            .order_by(ChatMessageRecord.sequence_number.desc())
            .limit(limit)
        )
        result = await self.session.scalars(query)
        # 제한은 최신 N개에 적용하고 반환은 대화의 시간 순서를 유지한다.
        return list(reversed(list(result)))
