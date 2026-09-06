from typing import Annotated
from uuid import UUID

from fastapi import Depends

from app.core.db.session import SessionDep
from app.dtos.subscriptions import PlanChangeData, PlanChangeRequest, SubscriptionData
from app.exceptions import PlanChangeNotAllowedError, SubscriptionInactiveError, SubscriptionNotFoundError
from app.models.subscriptions import Subscription, SubscriptionStatus
from app.repositories.household_repository import HouseholdRepository
from app.repositories.subscription_repository import SubscriptionRepository
from app.services.auth import get_subscription_repository
from app.services.households import get_household_repository


class SubscriptionService:
    def __init__(
        self,
        session: SessionDep,
        subscription_repo: Annotated[SubscriptionRepository, Depends(get_subscription_repository)],
        household_repo: Annotated[HouseholdRepository, Depends(get_household_repository)],
    ) -> None:
        self.session = session
        self.subscription_repo = subscription_repo
        self.household_repo = household_repo

    async def get_for_account(self, account_id: UUID) -> SubscriptionData:
        subscription = await self._require(account_id)
        return SubscriptionData.model_validate(subscription)

    async def request_plan_change(self, account_id: UUID, request: PlanChangeRequest) -> PlanChangeData:
        subscription = await self._require(account_id)

        if subscription.status is not SubscriptionStatus.ACTIVE:
            raise SubscriptionInactiveError()
        if subscription.plan == request.plan:
            raise PlanChangeNotAllowedError()

        # 소속된 활성 가정이 있는 경우, 가정 마스터만 플랜 변경 가능
        households = await self.household_repo.list_for_account(account_id)
        for household in households:
            if household.master_account_id != account_id:
                raise PlanChangeNotAllowedError("가정의 구독 플랜 변경은 가정 마스터만 가능합니다.")

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
