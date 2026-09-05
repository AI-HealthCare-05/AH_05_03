"""모든 매퍼를 Base.metadata에 등록한다.

alembic의 target_metadata는 임포트된 매퍼만 본다. 여기서 빠지면
autogenerate가 빈 마이그레이션을 만들거나 방금 만든 테이블을 drop하자고 한다.
"""

from app.models.challenge_settings import ChallengeMode, ChallengeSettings
from app.models.challenges import ChallengeAward, ChallengeCheck
from app.models.chat_sessions import ChatMessageRecord, ChatSession
from app.models.family_invitations import FamilyInvitation, InvitationStatus
from app.models.households import (
    Household,
    HouseholdMembership,
    HouseholdStatus,
    MembershipStatus,
    ProfileLink,
    ProfileLinkStatus,
)
from app.models.service_accounts import ServiceAccount, ServiceAccountStatus
from app.models.subscriptions import Subscription, SubscriptionPlan, SubscriptionStatus

__all__ = [
    "ChallengeAward",
    "ChallengeMode",
    "ChallengeSettings",
    "ChallengeCheck",
    "ChatMessageRecord",
    "ChatSession",
    "FamilyInvitation",
    "Household",
    "HouseholdMembership",
    "HouseholdStatus",
    "InvitationStatus",
    "MembershipStatus",
    "ProfileLink",
    "ProfileLinkStatus",
    "ServiceAccount",
    "ServiceAccountStatus",
    "Subscription",
    "SubscriptionPlan",
    "SubscriptionStatus",
]
