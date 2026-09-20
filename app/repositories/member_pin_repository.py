import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.member_pins import MemberPinCredential, MemberSession


class MemberPinRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_credential_for_update(self, profile_id: uuid.UUID) -> MemberPinCredential | None:
        return await self.session.scalar(
            select(MemberPinCredential).where(MemberPinCredential.profile_id == profile_id).with_for_update()
        )

    async def get_credential(self, profile_id: uuid.UUID) -> MemberPinCredential | None:
        return await self.session.scalar(
            select(MemberPinCredential).where(MemberPinCredential.profile_id == profile_id)
        )

    async def list_configured_profile_ids(self, profile_ids: list[uuid.UUID]) -> set[uuid.UUID]:
        if not profile_ids:
            return set()
        rows = await self.session.scalars(
            select(MemberPinCredential.profile_id).where(MemberPinCredential.profile_id.in_(profile_ids))
        )
        return set(rows.all())

    async def add_credential(self, credential: MemberPinCredential) -> MemberPinCredential:
        self.session.add(credential)
        await self.session.flush()
        return credential

    async def revoke_sessions(self, profile_id: uuid.UUID) -> None:
        now = datetime.now(tz=timezone.utc)
        await self.session.execute(
            update(MemberSession)
            .where(MemberSession.profile_id == profile_id, MemberSession.revoked_at.is_(None))
            .values(revoked_at=now)
        )

    async def revoke_sessions_for_household(self, household_id: uuid.UUID) -> int:
        now = datetime.now(tz=timezone.utc)
        result = await self.session.execute(
            update(MemberSession)
            .where(MemberSession.household_id == household_id, MemberSession.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        return int(getattr(result, "rowcount", 0) or 0)

    async def delete_credential(self, profile_id: uuid.UUID) -> None:
        await self.revoke_sessions(profile_id)
        await self.session.execute(delete(MemberPinCredential).where(MemberPinCredential.profile_id == profile_id))

    async def get_session(self, session_id: uuid.UUID) -> MemberSession | None:
        return await self.session.get(MemberSession, session_id)

    async def get_session_by_token_hash(self, token_hash: str) -> MemberSession | None:
        return await self.session.scalar(select(MemberSession).where(MemberSession.token_hash == token_hash))

    async def add_session(self, session_row: MemberSession) -> MemberSession:
        self.session.add(session_row)
        await self.session.flush()
        return session_row
