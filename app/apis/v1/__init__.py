from fastapi import APIRouter

from app.apis.v1.auth_routers import auth_router

v1_routers = APIRouter(prefix="/api/v1")
v1_routers.include_router(auth_router)
