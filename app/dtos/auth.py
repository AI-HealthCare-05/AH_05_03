import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, EmailStr, Field

from app.core.validators import validate_password
from app.dtos.base import BaseRequestModel, BaseSerializerModel
from app.models.service_accounts import ServiceAccountStatus


class SignUpRequest(BaseRequestModel):
    # docs/03_api_spec.md 2절이 요청에 프로필 이름·생년을 넣지 못하게 하고,
    # docs/02_erd.md의 service_accounts에는 담을 컬럼도 없다.
    email: Annotated[EmailStr, Field(max_length=254)]
    # bcrypt는 72바이트에서 조용히 절단한다.
    password: Annotated[str, Field(min_length=8, max_length=72), AfterValidator(validate_password)]


class LoginRequest(BaseRequestModel):
    email: EmailStr
    # min_length을 두면 짧은 오답이 422로 새어 비밀번호 정책이 노출된다.
    password: str


class SignUpData(BaseSerializerModel):
    account_id: uuid.UUID = Field(validation_alias="id")
    email: str
    status: ServiceAccountStatus


class AccessTokenData(BaseSerializerModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class AccountInfo(BaseSerializerModel):
    id: uuid.UUID
    email: str
    status: ServiceAccountStatus
    created_at: datetime
