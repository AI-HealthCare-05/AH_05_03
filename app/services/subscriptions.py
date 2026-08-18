from typing import Annotated
from uuid import UUID

from fastapi import Depends

from app.core.db.session import SessionDep
from app.dtos.subscriptions import PlanChangeData, PlanChangeRequest, SubscriptionData
from app.exceptions import PlanChangeNotAllowedError, SubscriptionInactiveError, SubscriptionNotFoundError
from app.models.subscriptions import Subscription, SubscriptionStatus
from app.repositories.subscription_repository import SubscriptionRepository
from app.services.auth import get_subscription_repository


class SubscriptionService:
    def __init__(
        self,
        session: SessionDep,
        subscription_repo: Annotated[SubscriptionRepository, Depends(get_subscription_repository)],
    ) -> None:
        self.session = session
        self.subscription_repo = subscription_repo

    async def get_for_account(self, account_id: UUID) -> SubscriptionData:
        subscription = await self._require(account_id)
        return SubscriptionData.model_validate(subscription)

    async def request_plan_change(self, account_id: UUID, request: PlanChangeRequest) -> PlanChangeData:
        subscription = await self._require(account_id)

        if subscription.status is not SubscriptionStatus.ACTIVE:
            raise SubscriptionInactiveError()
        if subscription.plan == request.plan:
            # DELETE /account와 달리 이건 종단 상태 도달이 아니다. 조용히
            # 200으로 받아주면 "요청이 실제로 반영됐는지" 클라이언트가
            # 확인할 방법이 없어져 버그를 숨긴다.
            raise PlanChangeNotAllowedError()

        previous_plan = subscription.plan
        await self.subscription_repo.update_plan(subscription, request.plan)
        await self.session.commit()

        return PlanChangeData(
            id=subscription.id,
            plan=subscription.plan,
            previous_plan=previous_plan,
            status=subscription.status,
            renewed_at=subscription.renewed_at,
        )

    async def _require(self, account_id: UUID) -> Subscription:
        subscription = await self.subscription_repo.get_by_account_id(account_id)
        if subscription is None:
            raise SubscriptionNotFoundError()
        return subscription
