import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.subscriptions import Subscription, SubscriptionPlan, SubscriptionStatus


class SubscriptionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_account_id(self, account_id: uuid.UUID) -> Subscription | None:
        return await self.session.scalar(select(Subscription).where(Subscription.account_id == account_id))

    async def create_default(self, account_id: uuid.UUID) -> Subscription:
        subscription = Subscription(account_id=account_id, plan=SubscriptionPlan.FREE, status=SubscriptionStatus.ACTIVE)
        self.session.add(subscription)
        await self.session.flush()
        return subscription

    async def update_plan(self, subscription: Subscription, plan: SubscriptionPlan) -> Subscription:
        subscription.plan = plan
        subscription.renewed_at = datetime.now(tz=timezone.utc)
        await self.session.flush()
        return subscription

    async def set_status(self, subscription: Subscription, status: SubscriptionStatus) -> Subscription:
        subscription.status = status
        await self.session.flush()
        return subscription
