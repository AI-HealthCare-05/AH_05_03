import uuid
from datetime import datetime

from pydantic import computed_field

from app.dtos.base import BaseRequestModel, BaseSerializerModel
from app.models.subscriptions import SubscriptionPlan, SubscriptionStatus


class SubscriptionBrief(BaseSerializerModel):
    """GET /account가 품는 요약용. 상세는 SubscriptionData."""

    plan: SubscriptionPlan
    status: SubscriptionStatus
    renewed_at: datetime | None


class SubscriptionData(BaseSerializerModel):
    id: uuid.UUID
    plan: SubscriptionPlan
    status: SubscriptionStatus
    renewed_at: datetime | None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def license_valid(self) -> bool:
        return self.status is SubscriptionStatus.ACTIVE


class PlanChangeRequest(BaseRequestModel):
    """POST /subscription/change 본문.

    ERD subscriptions에 사용자가 지정할 수 있는 열은 plan뿐이다. 결제·쿠폰·
    좌석수 같은 확장은 ERD에 자리도 없고 03_api_spec.md 8절이 확정 전
    표면 확장을 금한다.
    """

    plan: SubscriptionPlan


class PlanChangeData(BaseSerializerModel):
    id: uuid.UUID
    plan: SubscriptionPlan
    previous_plan: SubscriptionPlan
    status: SubscriptionStatus
    renewed_at: datetime | None
    applied: bool = True
