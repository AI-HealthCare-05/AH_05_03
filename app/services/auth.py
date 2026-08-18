from typing import Annotated

from fastapi import Depends
from fastapi.exceptions import HTTPException
from pydantic import EmailStr
from sqlalchemy.exc import IntegrityError
from starlette import status

from app.core.db.session import SessionDep
from app.core.jwt.tokens import AccessToken, RefreshToken
from app.core.utils.security import hash_password, verify_password
from app.dtos.auth import LoginRequest, SignUpRequest
from app.models.service_accounts import ServiceAccount, ServiceAccountStatus
from app.repositories.service_account_repository import ServiceAccountRepository
from app.services.jwt import JwtService


def get_account_repository(session: SessionDep) -> ServiceAccountRepository:
    return ServiceAccountRepository(session)


class AuthService:
    def __init__(
        self,
        session: SessionDep,
        account_repo: Annotated[ServiceAccountRepository, Depends(get_account_repository)],
    ) -> None:
        self.session = session
        self.account_repo = account_repo
        self.jwt_service = JwtService()

    async def signup(self, data: SignUpRequest) -> ServiceAccount:
        await self.check_email_exists(data.email)

        account = await self.account_repo.create(
            email=str(data.email),
            password_hash=hash_password(data.password),
        )

        # session.begin()을 쓰면 안 된다. autobegin=True라 위 SELECT가 이미
        # 트랜잭션을 열어놨고, begin()은 InvalidRequestError를 낸다.
        try:
            await self.session.commit()
        except IntegrityError as err:
            await self.session.rollback()
            # 사전 검사와 유니크 인덱스 둘 다 남긴다. 앞은 메시지가 좋고,
            # 뒤는 TOCTOU 경쟁을 실제로 막는다.
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 사용중인 이메일입니다.") from err

        return account

    async def authenticate(self, data: LoginRequest) -> ServiceAccount:
        account = await self.account_repo.get_by_email(str(data.email))
        if not account:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="이메일 또는 비밀번호가 올바르지 않습니다."
            )

        if not verify_password(data.password, account.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="이메일 또는 비밀번호가 올바르지 않습니다."
            )

        if account.status is not ServiceAccountStatus.ACTIVE:
            raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="비활성화된 계정입니다.")

        return account

    async def login(self, account: ServiceAccount) -> dict[str, AccessToken | RefreshToken]:
        # ERD service_accounts에 last_login 컬럼이 없으므로 갱신하지 않는다.
        return self.jwt_service.issue_jwt_pair(account)

    async def check_email_exists(self, email: str | EmailStr) -> None:
        if await self.account_repo.exists_by_email(str(email)):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 사용중인 이메일입니다.")
