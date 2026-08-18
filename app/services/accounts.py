from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends

from app.core.db.session import SessionDep
from app.dependencies.services import get_token_store
from app.dtos.accounts import AccountCloseData, AccountSummaryData
from app.dtos.auth import AccountInfo
from app.dtos.subscriptions import SubscriptionBrief
from app.exceptions import SubscriptionNotFoundError
from app.models.service_accounts import ServiceAccount, ServiceAccountStatus
from app.models.subscriptions import SubscriptionStatus
from app.repositories.service_account_repository import ServiceAccountRepository
from app.repositories.subscription_repository import SubscriptionRepository
from app.services.auth import get_account_repository, get_subscription_repository
from app.services.token_store import TokenStore


class AccountService:
    def __init__(
        self,
        session: SessionDep,
        account_repo: Annotated[ServiceAccountRepository, Depends(get_account_repository)],
        subscription_repo: Annotated[SubscriptionRepository, Depends(get_subscription_repository)],
        token_store: Annotated[TokenStore, Depends(get_token_store)],
    ) -> None:
        self.session = session
        self.account_repo = account_repo
        self.subscription_repo = subscription_repo
        self.token_store = token_store

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

    async def close(self, account: ServiceAccount) -> AccountCloseData:
        """DELETE /account — 유예기간 후 파기. 로컬 데이터는 서버가 모른다.

        멱등하다: get_current_account(상태 무관)로 들어오므로 이미 closed인
        계정에 다시 호출해도 같은 응답을 내며 아무것도 바꾸지 않는다.
        """
        closed_at = datetime.now(tz=timezone.utc)

        if account.status is not ServiceAccountStatus.CLOSED:
            await self.account_repo.set_status(account, ServiceAccountStatus.CLOSED, closed_at=closed_at)

            subscription = await self.subscription_repo.get_by_account_id(account.id)
            if subscription and subscription.status is SubscriptionStatus.ACTIVE:
                await self.subscription_repo.set_status(subscription, SubscriptionStatus.CANCELLED)

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
        )
