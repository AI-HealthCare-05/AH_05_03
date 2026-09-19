import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.core.errors import ErrorCode
from app.dependencies.concurrency import IfMatchHeader, parse_if_match
from app.dependencies.household_devices import require_active_household_device
from app.dependencies.security import require_active_account
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.household_devices import (
    DevicePairingCreatedData,
    DevicePairingCreateRequest,
    EmergencyDeviceRevocationData,
    EmergencyDeviceRevocationRequest,
    HouseholdDeviceClaimedData,
    HouseholdDeviceClaimRequest,
    HouseholdDeviceListData,
    HouseholdDeviceRevokeRequest,
    WallPinChallengeRequest,
    WallProfileListData,
)
from app.models.household_devices import HouseholdDevice
from app.models.service_accounts import ServiceAccount
from app.services.household_devices import HouseholdDeviceService

household_device_router = APIRouter(tags=["household-devices"])

_AUTH_ERRORS = (
    ErrorCode.AUTH_REQUIRED,
    ErrorCode.TOKEN_INVALID,
    ErrorCode.TOKEN_EXPIRED,
    ErrorCode.TOKEN_REVOKED,
    ErrorCode.ACCOUNT_NOT_FOUND,
    ErrorCode.ACCOUNT_SUSPENDED,
    ErrorCode.ACCOUNT_CLOSED,
    ErrorCode.SERVICE_UNAVAILABLE,
    ErrorCode.CREDENTIALS_INVALID,
)


@household_device_router.post(
    "/households/{household_id}/device-pairings",
    response_model=ApiResponse[DevicePairingCreatedData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MASTER_REQUIRED,
    ),
    summary="벽 기기 페어링 코드 발급",
)
async def create_device_pairing(
    household_id: uuid.UUID,
    req: DevicePairingCreateRequest,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HouseholdDeviceService, Depends(HouseholdDeviceService)],
) -> ApiResponse[DevicePairingCreatedData]:
    data = await service.create_pairing(household_id, account, req.password)
    response.headers["Location"] = f"/api/v1/households/{household_id}/device-pairings/{data.pairing_id}"
    return ApiResponse(data=data, message="페어링 코드를 발급했습니다. 원문은 이번만 보입니다.")


@household_device_router.get(
    "/households/{household_id}/devices",
    response_model=ApiResponse[HouseholdDeviceListData],
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MASTER_REQUIRED,
    ),
    summary="벽 기기 목록",
)
async def list_household_devices(
    household_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HouseholdDeviceService, Depends(HouseholdDeviceService)],
) -> ApiResponse[HouseholdDeviceListData]:
    data = await service.list_devices(household_id, account)
    return ApiResponse(data=data, message="벽 기기 목록을 조회했습니다.")


@household_device_router.delete(
    "/households/{household_id}/devices/{device_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MASTER_REQUIRED,
        ErrorCode.DEVICE_NOT_FOUND,
        ErrorCode.VERSION_MISMATCH,
    ),
    summary="벽 기기 철회",
)
async def revoke_household_device(
    household_id: uuid.UUID,
    device_id: uuid.UUID,
    req: HouseholdDeviceRevokeRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HouseholdDeviceService, Depends(HouseholdDeviceService)],
    if_match: IfMatchHeader = None,
) -> None:
    await service.revoke(
        household_id,
        device_id,
        account,
        req.password,
        expected_version=parse_if_match(if_match),
    )


@household_device_router.post(
    "/households/{household_id}/emergency-device-revocations",
    response_model=ApiResponse[EmergencyDeviceRevocationData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH_ERRORS,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MASTER_REQUIRED,
    ),
    summary="벽 기기·구성원 세션 비상 철회",
)
async def emergency_revoke_household_devices(
    household_id: uuid.UUID,
    req: EmergencyDeviceRevocationRequest,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[HouseholdDeviceService, Depends(HouseholdDeviceService)],
) -> ApiResponse[EmergencyDeviceRevocationData]:
    data = await service.emergency_revoke_all(household_id, account, req.password)
    response.headers["Location"] = f"/api/v1/households/{household_id}/emergency-device-revocations/{data.id}"
    return ApiResponse(data=data, message="벽 기기와 구성원 세션을 모두 철회했습니다.")


@household_device_router.post(
    "/household-devices",
    response_model=ApiResponse[HouseholdDeviceClaimedData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        ErrorCode.PAIRING_NOT_FOUND,
        ErrorCode.PAIRING_EXPIRED,
        ErrorCode.PAIRING_CONSUMED,
        ErrorCode.HOUSEHOLD_NOT_FOUND,
        ErrorCode.VALIDATION_ERROR,
    ),
    summary="페어링 코드로 벽 기기 등록",
)
async def claim_household_device(
    req: HouseholdDeviceClaimRequest,
    response: Response,
    service: Annotated[HouseholdDeviceService, Depends(HouseholdDeviceService)],
) -> ApiResponse[HouseholdDeviceClaimedData]:
    data = await service.claim_device(
        pairing_code=req.pairing_code,
        household_id=req.household_id,
        display_name=req.display_name,
        device_ref=req.device_ref,
    )
    response.headers["Location"] = f"/api/v1/household-devices/{data.id}"
    return ApiResponse(data=data, message="벽 기기를 등록했습니다. 기기 토큰은 이번만 보입니다.")


@household_device_router.get(
    "/household-devices/me/profiles",
    response_model=ApiResponse[WallProfileListData],
    responses=error_responses(ErrorCode.DEVICE_NOT_FOUND, ErrorCode.DEVICE_REVOKED, ErrorCode.AUTH_REQUIRED),
    summary="벽 가족 개요",
)
async def wall_profiles(
    device: Annotated[HouseholdDevice, Depends(require_active_household_device)],
    service: Annotated[HouseholdDeviceService, Depends(HouseholdDeviceService)],
) -> ApiResponse[WallProfileListData]:
    data = await service.wall_profiles(device)
    return ApiResponse(data=data, message="가족 개요를 조회했습니다.")


@household_device_router.post(
    "/household-devices/me/pin-challenges",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(
        ErrorCode.DEVICE_NOT_FOUND,
        ErrorCode.DEVICE_REVOKED,
        ErrorCode.AUTH_REQUIRED,
        ErrorCode.PROFILE_NOT_FOUND,
    ),
    summary="등록된 벽에서만 구성원 PIN 도전을 허용",
)
async def wall_pin_challenge(
    req: WallPinChallengeRequest,
    device: Annotated[HouseholdDevice, Depends(require_active_household_device)],
    service: Annotated[HouseholdDeviceService, Depends(HouseholdDeviceService)],
) -> None:
    await service.pin_challenge(device, req.profile_id)
