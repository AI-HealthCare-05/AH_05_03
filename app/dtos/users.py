from typing import Annotated

from pydantic import BaseModel, EmailStr, Field

from app.dtos.auth import AccountInfoResponse

# 이 모듈은 작업 단위 2에서 /users/me와 함께 사라진다.
# docs/03_api_spec.md의 계정 표면은 /account이고 계정 수정 엔드포인트는 없다.

UserInfoResponse = AccountInfoResponse


class UserUpdateRequest(BaseModel):
    # 이름·성별·생년·휴대폰은 서버에 저장하지 않으므로 수정할 것도 없다
    # (docs/05_tech_architecture.md 4절 금지 항목). 이메일만 남는다.
    email: Annotated[EmailStr | None, Field(None, max_length=254)]
