from datetime import date, datetime
from typing import Any

from pydantic import EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config
from app.models.users import Gender, User


class UserRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_all(self) -> list[User]:
        return list((await self.session.scalars(select(User))).all())

    async def get_user(self, user_id: int) -> User | None:
        return await self.session.get(User, user_id)

    async def create_user(self, email: str | EmailStr, hashed_password: str, name: str, phone_number: str,
                          gender: Gender, birthday: date, *, is_active: bool = True, is_admin: bool = False) -> User:
        user = User(email=str(email), hashed_password=hashed_password, name=name, phone_number=phone_number,
                    gender=gender, birthday=birthday, is_active=is_active, is_admin=is_admin)
        self.session.add(user)
        await self.session.flush()
        return user

    async def get_user_by_email(self, email: str) -> User | None:
        return await self.session.scalar(select(User).where(User.email == email))

    async def exists_by_email(self, email: str | EmailStr) -> bool:
        return (await self.session.scalar(select(User.id).where(User.email == str(email)).limit(1))) is not None

    async def exists_by_phone_number(self, phone_number: str) -> bool:
        return (await self.session.scalar(select(User.id).where(User.phone_number == phone_number).limit(1))) is not None

    async def update_last_login(self, user_id: int) -> None:
        user = await self.get_user(user_id)
        if user:
            user.last_login = datetime.now(config.TIMEZONE)

    async def update_instance(self, user: User, data: dict[str, Any]) -> None:
        for key, value in data.items():
            if value is not None:
                setattr(user, key, value)
        user.updated_at = datetime.now(config.TIMEZONE)
