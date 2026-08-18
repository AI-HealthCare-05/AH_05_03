from typing import Annotated

from fastapi import Depends

from app.core.db.session import SessionDep
from app.dtos.users import UserUpdateRequest
from app.models.service_accounts import ServiceAccount
from app.repositories.service_account_repository import ServiceAccountRepository
from app.services.auth import AuthService, get_account_repository


class UserManageService:
    def __init__(
        self,
        session: SessionDep,
        account_repo: Annotated[ServiceAccountRepository, Depends(get_account_repository)],
        auth_service: Annotated[AuthService, Depends(AuthService)],
    ) -> None:
        self.session = session
        self.account_repo = account_repo
        self.auth_service = auth_service

    async def update_user(self, account: ServiceAccount, data: UserUpdateRequest) -> ServiceAccount:
        if data.email:
            await self.auth_service.check_email_exists(data.email)

        await self.account_repo.update_instance(account, data.model_dump(exclude_none=True))
        await self.session.commit()
        # 예전 user.refresh_from_db()에 해당한다. expire_on_commit=False라
        # 서버 생성값(updated_at)이 메모리에서 낡기 때문에 명시적으로 다시 읽는다.
        await self.session.refresh(account)
        return account
