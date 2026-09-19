"""모든 매퍼를 Base.metadata에 등록한다.

alembic의 target_metadata는 임포트된 매퍼만 본다. 여기서 빠지면
autogenerate가 빈 마이그레이션을 만들거나 방금 만든 테이블을 drop하자고 한다.
"""

from app.models.challenge_settings import ChallengeMode, ChallengeSettings
from app.models.challenges import ChallengeAward, ChallengeCheck
from app.models.chat_sessions import ChatMessageRecord, ChatSession
from app.models.family_histories import FamilyHistory
from app.models.family_invitations import FamilyInvitation, InvitationStatus
from app.models.guardians import BirthDateCorrection, CivilMajorityTransition, GuardianLink, MinorDeletionRequest
from app.models.health_records import HealthRecord
from app.models.household_devices import HouseholdDevice, HouseholdDevicePairing, HouseholdDeviceStatus
from app.models.households import (
    Household,
    HouseholdMembership,
    HouseholdStatus,
    MembershipStatus,
    ProfileLink,
    ProfileLinkStatus,
)
from app.models.member_pins import MemberPinCredential, MemberSession
from app.models.profiles import (
    AccountAuditEvent,
    CapabilityGrant,
    FamilyProfile,
    LifecycleStatus,
    MemberRole,
    OwnershipType,
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
    "FamilyHistory",
    "FamilyInvitation",
    "GuardianLink",
    "BirthDateCorrection",
    "CivilMajorityTransition",
    "MinorDeletionRequest",
    "AccountAuditEvent",
    "CapabilityGrant",
    "FamilyProfile",
    "LifecycleStatus",
    "MemberRole",
    "OwnershipType",
    "HealthRecord",
    "Household",
    "HouseholdDevice",
    "HouseholdDevicePairing",
    "HouseholdDeviceStatus",
    "MemberPinCredential",
    "MemberSession",
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
