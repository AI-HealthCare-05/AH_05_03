from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db.databases import get_db_session
from app.services.auth import AuthService
from app.services.users import UserManageService


def get_auth_service(session: Annotated[AsyncSession, Depends(get_db_session)]) -> AuthService:
    return AuthService(session)


def get_user_manage_service(session: Annotated[AsyncSession, Depends(get_db_session)]) -> UserManageService:
    return UserManageService(session)
