import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core import config, default_logger
from app.core.db.session import SessionDep
from app.dependencies.services import get_invitation_store
from app.dtos.family_invitations import (
    FamilyInvitationCreatedData,
    FamilyInvitationCreateRequest,
    FamilyInvitationData,
    FamilyInvitationListData,
    InvitationTokenRequest,
)
from app.exceptions import (
    HouseholdMembershipRequiredError,
    HouseholdNotFoundError,
    InvitationAlreadyPendingError,
    InvitationExpiredError,
    InvitationNotFoundError,
    InvitationSelfNotAllowedError,
    InvitationStateConflictError,
    InvitationTokenInvalidError,
    ProfileReferenceAlreadyUsedError,
    TokenStoreUnavailableError,
)
from app.models.family_invitations import FamilyInvitation, InvitationStatus
from app.models.households import HouseholdStatus
from app.models.service_accounts import ServiceAccount
from app.repositories.family_invitation_repository import FamilyInvitationRepository
from app.repositories.household_repository import HouseholdRepository
from app.services.households import get_household_repository
from app.services.invitation_store import InvitationStore


def get_family_invitation_repository(session: SessionDep) -> FamilyInvitationRepository:
    return FamilyInvitationRepository(session)


class FamilyInvitationService:
    def __init__(
        self,
        session: SessionDep,
        invitation_repo: Annotated[FamilyInvitationRepository, Depends(get_family_invitation_repository)],
        household_repo: Annotated[HouseholdRepository, Depends(get_household_repository)],
        invitation_store: Annotated[InvitationStore, Depends(get_invitation_store)],
    ) -> None:
        self.session = session
        self.invitation_repo = invitation_repo
        self.household_repo = household_repo
        self.invitation_store = invitation_store

    async def create(
        self, account: ServiceAccount, request: FamilyInvitationCreateRequest
    ) -> FamilyInvitationCreatedData:
        email = str(request.invitee_email).lower()
        if email == account.email.lower():
            raise InvitationSelfNotAllowedError()

        household = await self.household_repo.get(request.household_id)
        if household is None or household.status is not HouseholdStatus.ACTIVE:
            raise HouseholdNotFoundError()
        if not await self.household_repo.has_active_membership(household.id, account.id):
            raise HouseholdMembershipRequiredError()

        await self.invitation_store.enforce_create_rate(account.id, email)
        now = datetime.now(tz=timezone.utc)
        await self._reject_reused_profile_ref(household.id, email, request.target_profile_ref, now)

        raw_token = secrets.token_urlsafe(config.FAMILY_INVITATION_TOKEN_BYTES)
        invitation = FamilyInvitation(
            id=uuid.uuid4(),
            household_id=household.id,
            inviter_account_id=account.id,
            invitee_email=email,
            target_profile_ref=request.target_profile_ref,
            token_hash=self.invitation_store.hash_token(raw_token),
            expires_at=now + timedelta(days=config.FAMILY_INVITATION_EXPIRE_DAYS),
        )
        registered = False
        try:
            await self.invitation_repo.create(invitation)
            ttl = max(int((invitation.expires_at - now).total_seconds()), 1)
            await self.invitation_store.register(invitation.id, email, raw_token, ttl)
            registered = True
            await self.session.commit()
            await self.session.refresh(invitation)
        except IntegrityError as err:
            await self.session.rollback()
            if registered:
                await self._best_effort_revoke(invitation)
            constraint = getattr(getattr(err.orig, "__cause__", None), "constraint_name", None)
            if constraint == "uq_family_invitations_profile_ref_lifetime":
                raise ProfileReferenceAlreadyUsedError() from err
            raise
        except Exception:
            await self.session.rollback()
            if registered:
                await self._best_effort_revoke(invitation)
            raise

        return FamilyInvitationCreatedData(invitation=self._serialize(invitation))

    async def _reject_reused_profile_ref(
        self, household_id: uuid.UUID, email: str, profile_ref: str, now: datetime
    ) -> None:
        previous = await self.invitation_repo.find_by_profile_ref(household_id, profile_ref)
        if previous is None:
            return
        if (
            previous.status is InvitationStatus.PENDING
            and previous.invitee_email.lower() == email
            and previous.expires_at > now
        ):
            raise InvitationAlreadyPendingError()
        raise ProfileReferenceAlreadyUsedError()

    async def list_for_account(self, account: ServiceAccount) -> FamilyInvitationListData:
        invitations = await self.invitation_repo.list_for_account(account.id, account.email)
        sent = [self._serialize(item) for item in invitations if item.inviter_account_id == account.id]
        received = [
            self._serialize(item) for item in invitations if item.invitee_email.lower() == account.email.lower()
        ]
        return FamilyInvitationListData(sent=sent, received=received)

    async def accept(
        self, invitation_id: uuid.UUID, account: ServiceAccount, request: InvitationTokenRequest
    ) -> FamilyInvitationData:
        await self.invitation_store.enforce_transition_rate(account.id, invitation_id)
        invitation = await self._require_recipient(invitation_id, account)
        await self._require_pending(invitation)
        self._verify_hash(invitation, request.token)
        restore_ttl = self._remaining_ttl(invitation)
        await self.invitation_store.consume(invitation.id, request.token)
        try:
            await self.household_repo.ensure_active_membership(invitation.household_id, account.id)
            invitation.status = InvitationStatus.ACCEPTED
            invitation.accepted_by_account_id = account.id
            invitation.accepted_at = datetime.now(tz=timezone.utc)
            invitation.row_version += 1
            await self.session.commit()
        except SQLAlchemyError:
            await self.session.rollback()
            await self._best_effort_restore(invitation_id, request.token, restore_ttl)
            raise
        await self.session.refresh(invitation)
        return self._serialize(invitation)

    async def decline(
        self, invitation_id: uuid.UUID, account: ServiceAccount, request: InvitationTokenRequest
    ) -> FamilyInvitationData:
        await self.invitation_store.enforce_transition_rate(account.id, invitation_id)
        invitation = await self._require_recipient(invitation_id, account)
        await self._require_pending(invitation)
        self._verify_hash(invitation, request.token)
        restore_ttl = self._remaining_ttl(invitation)
        await self.invitation_store.consume(invitation.id, request.token)
        try:
            invitation.status = InvitationStatus.DECLINED
            invitation.declined_at = datetime.now(tz=timezone.utc)
            invitation.row_version += 1
            await self.session.commit()
        except SQLAlchemyError:
            await self.session.rollback()
            await self._best_effort_restore(invitation_id, request.token, restore_ttl)
            raise
        await self.session.refresh(invitation)
        return self._serialize(invitation)

    async def cancel(self, invitation_id: uuid.UUID, account: ServiceAccount) -> FamilyInvitationData:
        invitation = await self.invitation_repo.get_for_update(invitation_id)
        if invitation is None or invitation.inviter_account_id != account.id:
            raise InvitationNotFoundError()
        await self._require_pending(invitation)

        invitation.status = InvitationStatus.CANCELLED
        invitation.cancelled_at = datetime.now(tz=timezone.utc)
        invitation.row_version += 1
        await self.session.commit()
        await self.session.refresh(invitation)
        await self._best_effort_revoke(invitation)
        return self._serialize(invitation)

    async def _require_recipient(self, invitation_id: uuid.UUID, account: ServiceAccount) -> FamilyInvitation:
        invitation = await self.invitation_repo.get_for_update(invitation_id)
        if invitation is None or invitation.invitee_email.lower() != account.email.lower():
            # 초대 존재 여부와 수신자 이메일을 권한 없는 계정에 노출하지 않는다.
            raise InvitationNotFoundError()
        return invitation

    async def _require_pending(self, invitation: FamilyInvitation) -> None:
        if invitation.status is not InvitationStatus.PENDING:
            raise InvitationStateConflictError()
        if invitation.expires_at <= datetime.now(tz=timezone.utc):
            invitation.status = InvitationStatus.EXPIRED
            invitation.row_version += 1
            await self.session.commit()
            await self._best_effort_revoke(invitation)
            raise InvitationExpiredError()

    def _verify_hash(self, invitation: FamilyInvitation, raw_token: str) -> None:
        if not hmac.compare_digest(invitation.token_hash, self.invitation_store.hash_token(raw_token)):
            raise InvitationTokenInvalidError()

    def _serialize(self, invitation: FamilyInvitation) -> FamilyInvitationData:
        result = FamilyInvitationData.model_validate(invitation)
        if result.status is InvitationStatus.PENDING and result.expires_at <= datetime.now(tz=timezone.utc):
            return result.model_copy(update={"status": InvitationStatus.EXPIRED})
        return result

    async def _best_effort_revoke(self, invitation: FamilyInvitation) -> None:
        try:
            await self.invitation_store.revoke(invitation.token_hash, invitation.id)
        except TokenStoreUnavailableError:
            # DB의 종단 상태가 정본이므로 안전성은 유지된다. TTL로도 정리된다.
            default_logger.warning("failed to revoke ephemeral invitation token %s", invitation.id)

    @staticmethod
    def _remaining_ttl(invitation: FamilyInvitation) -> int:
        return max(int((invitation.expires_at - datetime.now(tz=timezone.utc)).total_seconds()), 1)

    async def _best_effort_restore(self, invitation_id: uuid.UUID, raw_token: str, ttl: int) -> None:
        try:
            await self.invitation_store.restore(invitation_id, raw_token, ttl)
        except TokenStoreUnavailableError:
            # 복구 실패 시 토큰은 재사용 불가인 fail-closed 상태다.
            default_logger.error("failed to restore invitation token after DB rollback: %s", invitation_id)
