from datetime import date

from app.core import config
from app.services.minor_policy import (
    CIVIL_MAJORITY_AGE_YEARS,
    MINOR_POLICY_ID,
    PRIVACY_SELF_DETERMINATION_AGE_YEARS,
    age_years,
    has_reached_civil_majority,
    has_reached_privacy_self_determination,
    is_below_civil_majority,
    is_minor,
    policy_today,
)
from app.services.profile_capabilities import OwnershipType, infer_ownership


def test_policy_id_and_two_thresholds() -> None:
    assert MINOR_POLICY_ID == "kr-household-minor-v2"
    assert PRIVACY_SELF_DETERMINATION_AGE_YEARS == 14
    assert CIVIL_MAJORITY_AGE_YEARS == 19


def test_privacy_and_civil_boundaries() -> None:
    today = date(2026, 9, 19)
    assert is_minor("2012-09-20", today) is True
    assert is_minor("2012-09-19", today) is False
    assert has_reached_privacy_self_determination("2012-09-19", today) is True
    assert is_below_civil_majority("2007-09-20", today) is True
    assert has_reached_civil_majority("2007-09-19", today) is True
    assert has_reached_civil_majority("2012-09-19", today) is False


def test_adult_transition_flag_blocks_child_re_inference() -> None:
    asserted = infer_ownership(
        relationship="자녀",
        birth_date="2005-01-01",
        account_email=None,
        claimed_account_id=None,
        adult_transitioned=True,
    )
    assert asserted is OwnershipType.LOCAL_SLOT
    still_managed = infer_ownership(
        relationship="자녀",
        birth_date="2005-01-01",
        account_email=None,
        claimed_account_id=None,
        adult_transitioned=False,
    )
    assert still_managed is OwnershipType.GUARDIAN_MANAGED


def test_korean_age_uses_seoul_calendar_and_leap_birthdays() -> None:
    assert str(config.TIMEZONE) == "Asia/Seoul"
    assert policy_today(date(2026, 9, 20)) == date(2026, 9, 20)
    assert age_years("2007-09-20", date(2026, 9, 19)) == 18
    assert age_years("2007-09-20", date(2026, 9, 20)) == 19
    assert has_reached_civil_majority("2007-09-20", date(2026, 9, 20)) is True
    assert age_years("2008-02-29", date(2026, 2, 28)) == 17
    assert age_years("2008-02-29", date(2026, 3, 1)) == 18
    assert age_years("2012-02-29", date(2026, 2, 28)) == 13
    assert has_reached_privacy_self_determination("2012-02-29", date(2026, 3, 1)) is True
