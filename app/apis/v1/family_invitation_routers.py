import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.dependencies.security import get_request_user
from app.dtos.family_invitations import (
    FamilyInvitationCreateRequest,
    FamilyInvitationListResponse,
    FamilyInvitationResponse,
)
from app.models.users import User
from app.services.family_invitations import FamilyInvitationService

family_invitation_router = APIRouter(prefix="/family-invitations", tags=["family-invitations"])


@family_invitation_router.post("", response_model=FamilyInvitationResponse, status_code=status.HTTP_201_CREATED)
async def create_family_invitation(
    request: FamilyInvitationCreateRequest,
    user: Annotated[User, Depends(get_request_user)],
    service: Annotated[FamilyInvitationService, Depends(FamilyInvitationService)],
) -> FamilyInvitationResponse:
    invitation = await service.create(user, request)
    return FamilyInvitationResponse.model_validate(invitation)


@family_invitation_router.get("", response_model=FamilyInvitationListResponse)
async def list_family_invitations(
    user: Annotated[User, Depends(get_request_user)],
    service: Annotated[FamilyInvitationService, Depends(FamilyInvitationService)],
) -> FamilyInvitationListResponse:
    sent, received = await service.list_for_user(user)
    return FamilyInvitationListResponse(
        sent=[FamilyInvitationResponse.model_validate(item) for item in sent],
        received=[FamilyInvitationResponse.model_validate(item) for item in received],
    )


@family_invitation_router.post("/{invitation_id}/accept", response_model=FamilyInvitationResponse)
async def accept_family_invitation(
    invitation_id: uuid.UUID,
    user: Annotated[User, Depends(get_request_user)],
    service: Annotated[FamilyInvitationService, Depends(FamilyInvitationService)],
) -> FamilyInvitationResponse:
    return FamilyInvitationResponse.model_validate(await service.accept(invitation_id, user))


@family_invitation_router.post("/{invitation_id}/decline", response_model=FamilyInvitationResponse)
async def decline_family_invitation(
    invitation_id: uuid.UUID,
    user: Annotated[User, Depends(get_request_user)],
    service: Annotated[FamilyInvitationService, Depends(FamilyInvitationService)],
) -> FamilyInvitationResponse:
    return FamilyInvitationResponse.model_validate(await service.decline(invitation_id, user))


@family_invitation_router.delete("/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_family_invitation(
    invitation_id: uuid.UUID,
    user: Annotated[User, Depends(get_request_user)],
    service: Annotated[FamilyInvitationService, Depends(FamilyInvitationService)],
) -> Response:
    await service.cancel(invitation_id, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

