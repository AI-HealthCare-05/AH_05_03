from datetime import date, datetime
from typing import Any

from pydantic import EmailStr
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config
from app.models.users import Gender, User


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_all(self) -> list[User]:
        result = await self.session.scalars(select(User))
        return list(result.all())

    async def get_user(self, user_id: int) -> User | None:
        return await self.session.get(User, user_id)

    async def create_user(
        self,
        email: str | EmailStr,
        hashed_password: str,
        name: str,
        phone_number: str,
        gender: Gender,
        birthday: date,
        *,
        is_active: bool = True,
        is_admin: bool = False,
    ) -> User:
        user = User(
            email=str(email),
            hashed_password=hashed_password,
            name=name,
            phone_number=phone_number,
            gender=gender,
            birthday=birthday,
            is_active=is_active,
            is_admin=is_admin,
        )
        self.session.add(user)
        await self.session.flush()
        return user

    async def get_user_by_email(self, email: str) -> User | None:
        return await self.session.scalar(select(User).where(User.email == email))

    async def exists_by_email(self, email: str | EmailStr) -> bool:
        return bool(await self.session.scalar(select(exists().where(User.email == str(email)))))

    async def exists_by_phone_number(self, phone_number: str) -> bool:
        return bool(await self.session.scalar(select(exists().where(User.phone_number == phone_number))))

    async def update_last_login(self, user: User) -> None:
        user.last_login = datetime.now(config.TIMEZONE)
        await self.session.flush()

    async def update_instance(self, user: User, data: dict[str, Any]) -> None:
        changed = False
        for key, value in data.items():
            if value is not None:
                setattr(user, key, value)
                changed = True
        if changed:
            user.updated_at = datetime.now(config.TIMEZONE)
            await self.session.flush()
