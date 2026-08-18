from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import ORJSONResponse as Response

from app.dependencies.security import get_request_user
from app.dtos.users import UserInfoResponse, UserUpdateRequest
from app.models.service_accounts import ServiceAccount
from app.services.users import UserManageService

user_router = APIRouter(prefix="/users", tags=["users"])


@user_router.get("/me", response_model=UserInfoResponse, status_code=status.HTTP_200_OK)
async def user_me_info(
    user: Annotated[ServiceAccount, Depends(get_request_user)],
) -> Response:
    # mode="json"이 필요하다. asyncpg는 uuid.UUID 서브클래스인 pgproto.UUID를
    # 돌려주는데 orjson이 그 타입을 직렬화하지 못한다.
    return Response(UserInfoResponse.model_validate(user).model_dump(mode="json"), status_code=status.HTTP_200_OK)


@user_router.patch("/me", response_model=UserInfoResponse, status_code=status.HTTP_200_OK)
async def update_user_me_info(
    update_data: UserUpdateRequest,
    user: Annotated[ServiceAccount, Depends(get_request_user)],
    user_manage_service: Annotated[UserManageService, Depends(UserManageService)],
) -> Response:
    updated_user = await user_manage_service.update_user(account=user, data=update_data)
    return Response(
        UserInfoResponse.model_validate(updated_user).model_dump(mode="json"),
        status_code=status.HTTP_200_OK,
    )
