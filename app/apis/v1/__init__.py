from fastapi import APIRouter

from app.apis.v1.account_routers import account_router
from app.apis.v1.auth_routers import auth_router
from app.apis.v1.family_invitation_routers import family_invitation_router
from app.apis.v1.household_routers import household_router
from app.apis.v1.subscription_routers import subscription_router

v1_routers = APIRouter(prefix="/api/v1")
v1_routers.include_router(auth_router)
v1_routers.include_router(account_router)
v1_routers.include_router(subscription_router)
v1_routers.include_router(household_router)
v1_routers.include_router(family_invitation_router)
