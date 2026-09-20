"""가구 미성년 연령 정책. 법률 결론이 아니라 제품 버전이다.

만 14세는 개인정보 자기결정, 만 19세는 민법상 성년이다. 라우터·프런트에
숫자를 다시 쓰지 않는다. ADR-013. 만 나이는 Asia/Seoul 달력일이다.
"""

from datetime import date, datetime

MINOR_POLICY_ID = "kr-household-minor-v2"
PRIVACY_SELF_DETERMINATION_AGE_YEARS = 14
CIVIL_MAJORITY_AGE_YEARS = 19


def policy_today(today: date | None = None) -> date:
    if today is not None:
        return today
    from app.core import config

    return datetime.now(tz=config.TIMEZONE).date()


def age_years(birth_date: str | None, today: date | None = None) -> int | None:
    if birth_date is None or len(birth_date) < 10:
        return None
    try:
        born = date.fromisoformat(birth_date[:10])
    except ValueError:
        return None
    on = policy_today(today)
    return on.year - born.year - ((on.month, on.day) < (born.month, born.day))


def is_below_privacy_self_determination(birth_date: str | None, today: date | None = None) -> bool | None:
    years = age_years(birth_date, today)
    if years is None:
        return None
    return years < PRIVACY_SELF_DETERMINATION_AGE_YEARS


def is_below_civil_majority(birth_date: str | None, today: date | None = None) -> bool | None:
    years = age_years(birth_date, today)
    if years is None:
        return None
    return years < CIVIL_MAJORITY_AGE_YEARS


def is_minor(birth_date: str | None, today: date | None = None) -> bool | None:
    """보호자 관리 추론용. 만 14세 미만만 생년으로 관리형으로 올린다."""
    return is_below_privacy_self_determination(birth_date, today)


def has_reached_privacy_self_determination(birth_date: str | None, today: date | None = None) -> bool:
    years = age_years(birth_date, today)
    return years is not None and years >= PRIVACY_SELF_DETERMINATION_AGE_YEARS


def has_reached_civil_majority(birth_date: str | None, today: date | None = None) -> bool:
    years = age_years(birth_date, today)
    return years is not None and years >= CIVIL_MAJORITY_AGE_YEARS
