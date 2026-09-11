from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends
from sqlalchemy.exc import IntegrityError

from app.core.db.session import SessionDep
from app.core.utils.security import hash_password, hash_password_async, verify_password_async
from app.dependencies.services import get_token_store
from app.dtos.auth import AccessTokenData, LoginRequest, SignUpRequest
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


@dataclass(frozen=True, slots=True)
class IssuedTokens:
    """서비스 내부 토큰 묶음.

    Refresh Token은 라우터가 HttpOnly 쿠키로만 전달하고 응답 DTO에는 절대
    넣지 않는다.
    """

    access: AccessTokenData
    refresh_token: str
    refresh_expires_in: int


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
        existing = await self.account_repo.get_by_email(str(data.email))
        # CLOSED(탈퇴)만 재가입 대상이다. ACTIVE·SUSPENDED와 부딪히면 여전히 409 —
        # 정지 계정이 재가입으로 정지를 우회하게 두지 않는다.
        if existing is not None and existing.status is not ServiceAccountStatus.CLOSED:
            raise EmailAlreadyRegisteredError()

        # 스레드로 뺀다 — 동기로 부르면 206ms 동안 이 워커 전체가 멈춘다.
        password_hash = await hash_password_async(data.password)

        if existing is None:
            account = await self.account_repo.create(email=str(data.email), password_hash=password_hash)
            # 같은 트랜잭션에서 기본 구독을 만든다. 그래야 SUBSCRIPTION_NOT_FOUND가
            # 신규 계정의 정상 상태가 아니라 진짜 불변식 위반이 된다.
            await self.subscription_repo.create_default(account.id)
        else:
            # email이 unique라 탈퇴 계정과 같은 이메일로는 새 행을 못 만든다.
            # 기존 행을 덮어써 되살린다 — 비밀번호와 구독 모두 신규 가입과 같은
            # 상태(ACTIVE·FREE)로 돌아간다.
            account = await self.account_repo.reactivate(existing, password_hash)
            subscription = await self.subscription_repo.get_by_account_id(account.id)
            if subscription is None:
                # 불변식 방어: signup은 항상 구독을 만들어 뒀어야 한다.
                await self.subscription_repo.create_default(account.id)
            else:
                await self.subscription_repo.reactivate_default(subscription)

        # session.begin()을 쓰면 안 된다. autobegin=True라 위 SELECT가 이미
        # 트랜잭션을 열어놨고, begin()은 InvalidRequestError를 낸다.
        try:
            await self.session.commit()
        except IntegrityError as err:
            await self.session.rollback()
            # 사전 검사와 유니크 인덱스 둘 다 남긴다. 앞은 메시지가 좋고,
            # 뒤는 신규 이메일 경쟁의 TOCTOU를 실제로 막는다.
            raise EmailAlreadyRegisteredError() from err

        return account

    async def authenticate(self, data: LoginRequest) -> ServiceAccount:
        account = await self.account_repo.get_by_email(str(data.email))

        password_hash = account.password_hash if account else _DUMMY_PASSWORD_HASH
        # 스레드로 뺀다. 여기가 로그인 지연의 거의 전부이고, 동기로 두면 동시
        # 로그인이 완전히 직렬화된다(80건 = 17초). 타이밍 방어는 그대로다 —
        # 계정이 없어도 더미 해시로 같은 비용을 치른다.
        password_ok = await verify_password_async(data.password, password_hash)

        if not account or not password_ok:
            raise CredentialsInvalidError()

        # **정지·해지 상태를 여기서 구분해 알리지 않는다.** `AccountSuspendedError`
        # ·`AccountClosedError`는 401이 아니라 403이고 메시지도 다르다 — 익명
        # 로그인 시도자에게 "이 이메일은 실제로 가입돼 있고 지금 해지·정지
        # 상태다"를 그대로 확인해 주는 통로가 된다. `test_wrong_password_and_
        # unknown_email_look_identical`이 지키려던 것과 같은 경계인데 그 계정
        # 상태 축만 비어 있었다. 같은 계정으로 인증된 뒤(`refresh`)의 상태
        # 확인은 다르다 — 그때는 호출자가 이미 그 계정임을 증명한 뒤다.
        if account.status in (ServiceAccountStatus.SUSPENDED, ServiceAccountStatus.CLOSED):
            raise CredentialsInvalidError()

        return account

    async def login(self, account: ServiceAccount) -> IssuedTokens:
        # ERD service_accounts에 last_login 컬럼이 없으므로 갱신하지 않는다.
        access, refresh = self.jwt_service.issue_pair(account)
        await self.token_store.register_refresh(account.id, str(refresh["jti"]), exp=refresh["exp"])
        return self._pair_data(access, refresh)

    async def refresh(self, raw_refresh_token: str) -> IssuedTokens:
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

    @staticmethod
    def _pair_data(access, refresh) -> IssuedTokens:
        return IssuedTokens(
            access=AccessTokenData(
                access_token=str(access),
                expires_in=access["exp"] - access["iat"],
            ),
            refresh_token=str(refresh),
            refresh_expires_in=refresh["exp"] - refresh["iat"],
        )
