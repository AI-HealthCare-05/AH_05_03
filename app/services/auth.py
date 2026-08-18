from typing import Annotated

from fastapi import Depends
from pydantic import EmailStr
from sqlalchemy.exc import IntegrityError

from app.core.db.session import SessionDep
from app.core.utils.security import hash_password, verify_password
from app.dependencies.services import get_token_store
from app.dtos.auth import LoginRequest, SignUpRequest, TokenPairData
from app.exceptions import (
    AccountClosedError,
    AccountNotFoundError,
    AccountSuspendedError,
    CredentialsInvalidError,
    EmailAlreadyRegisteredError,
    TokenReuseDetectedError,
    TokenRevokedError,
)
from app.models.service_accounts import ServiceAccount, ServiceAccountStatus
from app.repositories.service_account_repository import ServiceAccountRepository
from app.repositories.subscription_repository import SubscriptionRepository
from app.services.jwt import JwtService, account_id_from_payload
from app.services.token_store import TokenStore

# 이메일이 존재하지 않을 때도 verify_password를 반드시 실행한다.
# 그래야 "이메일 없음"과 "비밀번호 오답"의 응답 시간이 같아져
# 이메일 존재 여부가 타이밍으로 새지 않는다.
_DUMMY_PASSWORD_HASH = hash_password("not-a-real-password-used-only-for-timing")


def get_account_repository(session: SessionDep) -> ServiceAccountRepository:
    return ServiceAccountRepository(session)


def get_subscription_repository(session: SessionDep) -> SubscriptionRepository:
    return SubscriptionRepository(session)


class AuthService:
    def __init__(
        self,
        session: SessionDep,
        account_repo: Annotated[ServiceAccountRepository, Depends(get_account_repository)],
        subscription_repo: Annotated[SubscriptionRepository, Depends(get_subscription_repository)],
        token_store: Annotated[TokenStore, Depends(get_token_store)],
    ) -> None:
        self.session = session
        self.account_repo = account_repo
        self.subscription_repo = subscription_repo
        self.token_store = token_store
        self.jwt_service = JwtService()

    async def signup(self, data: SignUpRequest) -> ServiceAccount:
        await self.check_email_exists(data.email)

        account = await self.account_repo.create(
            email=str(data.email),
            password_hash=hash_password(data.password),
        )
        # 같은 트랜잭션에서 기본 구독을 만든다. 그래야 SUBSCRIPTION_NOT_FOUND가
        # 신규 계정의 정상 상태가 아니라 진짜 불변식 위반이 된다.
        await self.subscription_repo.create_default(account.id)

        # session.begin()을 쓰면 안 된다. autobegin=True라 위 SELECT가 이미
        # 트랜잭션을 열어놨고, begin()은 InvalidRequestError를 낸다.
        try:
            await self.session.commit()
        except IntegrityError as err:
            await self.session.rollback()
            # 사전 검사와 유니크 인덱스 둘 다 남긴다. 앞은 메시지가 좋고,
            # 뒤는 TOCTOU 경쟁을 실제로 막는다.
            raise EmailAlreadyRegisteredError() from err

        return account

    async def authenticate(self, data: LoginRequest) -> ServiceAccount:
        account = await self.account_repo.get_by_email(str(data.email))

        password_hash = account.password_hash if account else _DUMMY_PASSWORD_HASH
        password_ok = verify_password(data.password, password_hash)

        if not account or not password_ok:
            raise CredentialsInvalidError()

        if account.status is ServiceAccountStatus.SUSPENDED:
            raise AccountSuspendedError()
        if account.status is ServiceAccountStatus.CLOSED:
            raise AccountClosedError()

        return account

    async def login(self, account: ServiceAccount) -> TokenPairData:
        # ERD service_accounts에 last_login 컬럼이 없으므로 갱신하지 않는다.
        access, refresh = self.jwt_service.issue_pair(account)
        await self.token_store.register_refresh(account.id, str(refresh["jti"]), exp=refresh["exp"])
        return self._pair_data(access, refresh)

    async def refresh(self, raw_refresh_token: str) -> TokenPairData:
        refresh_token = self.jwt_service.verify_jwt(raw_refresh_token, "refresh")
        account_id = account_id_from_payload(refresh_token.payload)

        # 계정 조회보다 먼저 소비한다. 순서를 바꾸면 동시 요청 두 개가
        # 같은 jti를 나란히 통과할 여지가 생긴다.
        await self.token_store.consume_refresh(account_id, str(refresh_token["jti"]), exp=refresh_token["exp"])

        account = await self.account_repo.get_by_id(account_id)
        if not account:
            raise AccountNotFoundError()
        if account.status is ServiceAccountStatus.SUSPENDED:
            raise AccountSuspendedError()
        if account.status is ServiceAccountStatus.CLOSED:
            raise AccountClosedError()

        access, new_refresh = self.jwt_service.issue_pair(account)
        await self.token_store.register_refresh(account.id, str(new_refresh["jti"]), exp=new_refresh["exp"])
        return self._pair_data(access, new_refresh)

    async def logout(self, access_payload: dict) -> None:
        account_id = account_id_from_payload(access_payload)

        sid = access_payload.get("sid")
        if sid:
            # 짝이 되는 refresh도 함께 죽인다. 이미 회전/소진됐다면
            # consume_refresh가 던지는 오류는 로그아웃 관점에서 무해하다 —
            # 목표(그 refresh가 더 이상 못 쓰임)는 이미 달성된 상태다.
            try:
                await self.token_store.consume_refresh(account_id, str(sid))
            except (TokenRevokedError, TokenReuseDetectedError):
                pass

        await self.token_store.deny_access(str(access_payload["jti"]), exp=access_payload.get("exp"))

    async def check_email_exists(self, email: str | EmailStr) -> None:
        if await self.account_repo.exists_by_email(str(email)):
            raise EmailAlreadyRegisteredError()

    @staticmethod
    def _pair_data(access, refresh) -> TokenPairData:
        return TokenPairData(
            access_token=str(access),
            refresh_token=str(refresh),
            expires_in=access["exp"] - access["iat"],
            refresh_expires_in=refresh["exp"] - refresh["iat"],
        )
