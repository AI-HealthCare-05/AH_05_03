import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.guardians import (
    BirthDateCorrection,
    CivilMajorityTransition,
    GuardianLink,
    GuardianLinkKind,
    GuardianVerificationStatus,
    MinorDeletionRequest,
    MinorDeletionStatus,
)

_OPEN_DELETION = frozenset(
    {
        MinorDeletionStatus.SUBMITTED.value,
        MinorDeletionStatus.UNDER_REVIEW.value,
        MinorDeletionStatus.APPEALED.value,
    }
)


class GuardianRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_link(self, link_id: uuid.UUID) -> GuardianLink | None:
        return await self.session.get(GuardianLink, link_id)

    async def get_link_for_update(self, link_id: uuid.UUID) -> GuardianLink | None:
        return await self.session.scalar(select(GuardianLink).where(GuardianLink.id == link_id).with_for_update())

    async def find_link(
        self, profile_id: uuid.UUID, account_id: uuid.UUID, kind: GuardianLinkKind
    ) -> GuardianLink | None:
        return await self.session.scalar(
            select(GuardianLink).where(
                GuardianLink.profile_id == profile_id,
                GuardianLink.account_id == account_id,
                GuardianLink.kind == kind.value,
            )
        )

    async def list_links(self, profile_id: uuid.UUID) -> list[GuardianLink]:
        result = await self.session.scalars(select(GuardianLink).where(GuardianLink.profile_id == profile_id))
        return list(result)

    async def add_link(self, link: GuardianLink) -> GuardianLink:
        self.session.add(link)
        await self.session.flush()
        return link

    async def expire_profile_links(self, profile_id: uuid.UUID) -> None:
        now = datetime.now(tz=timezone.utc)
        links = await self.list_links(profile_id)
        for link in links:
            link.verification_status = GuardianVerificationStatus.EXPIRED.value
            link.expires_at = now
            link.row_version += 1

    def effective_legal_status(self, link: GuardianLink | None, *, now: datetime) -> str | None:
        if link is None:
            return None
        if (
            link.verification_status == GuardianVerificationStatus.VERIFIED.value
            and link.expires_at is not None
            and link.expires_at <= now
        ):
            return GuardianVerificationStatus.EXPIRED.value
        return link.verification_status

    async def legal_status_for_account(
        self, profile_id: uuid.UUID, account_id: uuid.UUID, *, now: datetime
    ) -> str | None:
        link = await self.find_link(profile_id, account_id, GuardianLinkKind.LEGAL_REPRESENTATIVE)
        return self.effective_legal_status(link, now=now)

    async def is_product_guardian(self, profile_id: uuid.UUID, account_id: uuid.UUID) -> bool:
        link = await self.find_link(profile_id, account_id, GuardianLinkKind.PRODUCT_GUARDIAN)
        if link is None:
            return False
        return link.verification_status != GuardianVerificationStatus.EXPIRED.value

    async def get_deletion(self, request_id: uuid.UUID) -> MinorDeletionRequest | None:
        return await self.session.get(MinorDeletionRequest, request_id)

    async def get_deletion_for_update(self, request_id: uuid.UUID) -> MinorDeletionRequest | None:
        return await self.session.scalar(
            select(MinorDeletionRequest).where(MinorDeletionRequest.id == request_id).with_for_update()
        )

    async def open_deletion(self, profile_id: uuid.UUID) -> MinorDeletionRequest | None:
        return await self.session.scalar(
            select(MinorDeletionRequest).where(
                MinorDeletionRequest.profile_id == profile_id,
                MinorDeletionRequest.status.in_(_OPEN_DELETION),
            )
        )

    async def latest_deletion(self, profile_id: uuid.UUID) -> MinorDeletionRequest | None:
        return await self.session.scalar(
            select(MinorDeletionRequest)
            .where(MinorDeletionRequest.profile_id == profile_id)
            .order_by(MinorDeletionRequest.created_at.desc())
            .limit(1)
        )

    async def add_deletion(self, row: MinorDeletionRequest) -> MinorDeletionRequest:
        self.session.add(row)
        await self.session.flush()
        return row

    async def add_birth_date_correction(self, row: BirthDateCorrection) -> BirthDateCorrection:
        self.session.add(row)
        await self.session.flush()
        return row

    async def clear_share_reapprovals(self, profile_id: uuid.UUID) -> None:
        for link in await self.list_links(profile_id):
            if link.kind == GuardianLinkKind.PRODUCT_GUARDIAN.value:
                link.share_reapproved_at = None
                link.share_capabilities = ""
                link.share_expires_at = None
                link.share_revoked_at = None
                link.share_policy_version = None
                link.share_reauthenticated_at = None
                link.share_grantor_account_id = None
                link.row_version += 1

    async def add_transition(self, row: CivilMajorityTransition) -> CivilMajorityTransition:
        self.session.add(row)
        await self.session.flush()
        return row

    async def get_transition_by_invalidation_key(self, key: str) -> CivilMajorityTransition | None:
        return await self.session.scalar(
            select(CivilMajorityTransition).where(CivilMajorityTransition.invalidation_idempotency_key == key)
        )

    async def get_active_transition(self, profile_id: uuid.UUID) -> CivilMajorityTransition | None:
        return await self.session.scalar(
            select(CivilMajorityTransition)
            .where(
                CivilMajorityTransition.profile_id == profile_id,
                CivilMajorityTransition.invalidated_at.is_(None),
            )
            .with_for_update()
        )
