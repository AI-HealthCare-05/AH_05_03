from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends
from sqlalchemy import delete

from app.core.db.session import SessionDep
from app.dependencies.services import get_token_store
from app.dtos.accounts import AccountCloseData, AccountSummaryData
from app.dtos.auth import AccountInfo
from app.dtos.subscriptions import SubscriptionBrief
from app.exceptions import SubscriptionNotFoundError
from app.models.profiles import FamilyProfile
from app.models.service_accounts import ServiceAccount, ServiceAccountStatus
from app.models.subscriptions import SubscriptionStatus
from app.repositories.household_repository import HouseholdRepository
from app.repositories.service_account_repository import ServiceAccountRepository
from app.repositories.subscription_repository import SubscriptionRepository
from app.services.auth import get_account_repository, get_subscription_repository
from app.services.households import get_household_repository
from app.services.token_store import TokenStore


class AccountService:
    def __init__(
        self,
        session: SessionDep,
        account_repo: Annotated[ServiceAccountRepository, Depends(get_account_repository)],
        subscription_repo: Annotated[SubscriptionRepository, Depends(get_subscription_repository)],
        token_store: Annotated[TokenStore, Depends(get_token_store)],
        household_repo: Annotated[HouseholdRepository, Depends(get_household_repository)],
    ) -> None:
        self.session = session
        self.account_repo = account_repo
        self.subscription_repo = subscription_repo
        self.token_store = token_store
        self.household_repo = household_repo

    async def get_summary(self, account: ServiceAccount) -> AccountSummaryData:
        subscription = await self.subscription_repo.get_by_account_id(account.id)
        if subscription is None:
            # signup이 항상 기본 구독을 만들므로, 여기 걸리면 데이터 정합성이
            # 깨진 것이지 사용자 입력 문제가 아니다.
            raise SubscriptionNotFoundError()

        return AccountSummaryData(
            account=AccountInfo.model_validate(account),
            subscription=SubscriptionBrief.model_validate(subscription),
        )

    async def close(self, account: ServiceAccount, purge_health_data: bool = False) -> AccountCloseData:
        """DELETE /account — 유예기간 후 파기. purge_health_data=True 시 서버 DB 데이터 영구 폐기.

        멱등하다: get_current_account(상태 무관)로 들어오므로 이미 closed인
        계정에 다시 호출해도 같은 응답을 내며 아무것도 바꾸지 않는다.
        """
        closed_at = datetime.now(tz=timezone.utc)
        purged = False

        if account.status is not ServiceAccountStatus.CLOSED:
            await self.account_repo.set_status(account, ServiceAccountStatus.CLOSED, closed_at=closed_at)

            subscription = await self.subscription_repo.get_by_account_id(account.id)
            if subscription and subscription.status is SubscriptionStatus.ACTIVE:
                await self.subscription_repo.set_status(subscription, SubscriptionStatus.CANCELLED)

            # 탈퇴 시 건강정보 폐기 요청이 있으면 서버 DB 내 프로필 및 건강기록 영구 삭제
            if purge_health_data:
                await self.session.execute(
                    delete(FamilyProfile).where(FamilyProfile.created_by_account_id == account.id)
                )
                purged = True

            touched = await self.household_repo.release_all_memberships(account.id)
            await self.household_repo.close_if_empty(touched)

            # DB를 먼저 커밋하고 나서 Redis를 무효화한다. 순서를 바꾸면 Redis
            # 실패가 "계정은 안 닫혔는데 토큰만 죽은" 상태를 만들 수 있다.
            await self.session.commit()
            await self.token_store.revoke_all_refresh(account.id)
        else:
            closed_at = account.closed_at or closed_at

        subscription = await self.subscription_repo.get_by_account_id(account.id)
        subscription_status = subscription.status if subscription else SubscriptionStatus.CANCELLED

        return AccountCloseData(
            account_id=account.id,
            status=ServiceAccountStatus.CLOSED,
            closed_at=closed_at,
            subscription_status=subscription_status,
            local_data_deleted=False,
            health_data_purged=purged,
        )
