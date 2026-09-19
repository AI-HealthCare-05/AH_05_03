from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials

from app.dependencies.security import security
from app.exceptions import AuthRequiredError, DeviceNotFoundError, DeviceRevokedError
from app.models.household_devices import HouseholdDevice
from app.services.household_devices import HouseholdDeviceService


async def require_active_household_device(
    credential: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    service: Annotated[HouseholdDeviceService, Depends(HouseholdDeviceService)],
) -> HouseholdDevice:
    if credential is None:
        raise AuthRequiredError()
    try:
        return await service.resolve_device_token(credential.credentials)
    except DeviceNotFoundError:
        raise AuthRequiredError() from None
    except DeviceRevokedError:
        raise
