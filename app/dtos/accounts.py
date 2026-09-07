import uuid
from datetime import datetime

from app.dtos.auth import AccountInfo
from app.dtos.base import BaseSerializerModel
from app.dtos.subscriptions import SubscriptionBrief
from app.models.service_accounts import ServiceAccountStatus
from app.models.subscriptions import SubscriptionStatus


class AccountSummaryData(BaseSerializerModel):
    """GET /account — "계정·구독 요약".

    account/subscription 필드만 명시적으로 나열한다. ORM 행을 통째로
    model_dump하지 않는 이유는 실수로 새 컬럼이 응답에 새어 나가는 것을
    막기 위해서다 (docs/05_tech_architecture.md 4절 서버 금지 항목).
    """

    account: AccountInfo
    subscription: SubscriptionBrief


class AccountCloseRequest(BaseSerializerModel):
    purge_health_data: bool = False


class AccountCloseData(BaseSerializerModel):
    account_id: uuid.UUID
    status: ServiceAccountStatus
    closed_at: datetime
    subscription_status: SubscriptionStatus
    local_data_deleted: bool = False
    health_data_purged: bool = False
