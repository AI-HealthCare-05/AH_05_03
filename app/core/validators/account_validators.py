import re


def validate_password(password: str) -> str:
    if len(password) < 8:
        raise ValueError("비밀번호는 8자 이상이어야 합니다.")

    # 대문자를 포함하고 있는지
    if not re.search(r"[A-Z]", password):
        raise ValueError("비밀번호에는 대문자, 소문자, 특수문자, 숫자가 각 하나씩 포함되어야 합니다.")

    # 소문자를 포함하고 있는지
    if not re.search(r"[a-z]", password):
        raise ValueError("비밀번호에는 대문자, 소문자, 특수문자, 숫자가 각 하나씩 포함되어야 합니다.")

    # 숫자를 포함하고 있는지
    if not re.search(r"[0-9]", password):
        raise ValueError("비밀번호에는 대문자, 소문자, 특수문자, 숫자가 각 하나씩 포함되어야 합니다.")

    # 특수문자를 포함하고 있는지
    if not re.search(r"[^a-zA-Z0-9]", password):
        raise ValueError("비밀번호에는 대문자, 소문자, 특수문자, 숫자가 각 하나씩 포함되어야 합니다.")

    return password
