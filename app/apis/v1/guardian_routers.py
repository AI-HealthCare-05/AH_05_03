import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.core.errors import ErrorCode
from app.dependencies.security import require_active_account
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.guardians import (
    BirthDateCorrectionData,
    BirthDateCorrectionRequest,
    CivilMajorityTransitionRequest,
    GuardianLinkCreateRequest,
    GuardianLinkData,
    GuardianLinkListData,
    GuardianShareReapprovalRequest,
    MinorDeletionRequestCreate,
    MinorDeletionRequestData,
    MinorDeletionReviewRequest,
    PrivacySelfDeterminationRequest,
)
from app.dtos.profiles import ProfileData
from app.models.service_accounts import ServiceAccount
from app.services.guardians import GuardianService

guardian_router = APIRouter(tags=["guardians"])

_AUTH = (
    ErrorCode.AUTH_REQUIRED,
    ErrorCode.TOKEN_INVALID,
    ErrorCode.TOKEN_EXPIRED,
    ErrorCode.TOKEN_REVOKED,
    ErrorCode.ACCOUNT_NOT_FOUND,
    ErrorCode.ACCOUNT_SUSPENDED,
    ErrorCode.ACCOUNT_CLOSED,
)


@guardian_router.get(
    "/profiles/{profile_id}/guardian-links",
    response_model=ApiResponse[GuardianLinkListData],
    responses=error_responses(*_AUTH, ErrorCode.PROFILE_NOT_FOUND, ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED),
    summary="프로필 보호자·법정대리 링크 목록",
)
async def list_guardian_links(
    profile_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[GuardianService, Depends(GuardianService)],
) -> ApiResponse[GuardianLinkListData]:
    data = await service.list_links(account, profile_id)
    return ApiResponse(data=data, message="보호자 링크를 조회했습니다.")


@guardian_router.post(
    "/profiles/{profile_id}/guardian-links",
    response_model=ApiResponse[GuardianLinkData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MASTER_REQUIRED,
        ErrorCode.PROFILE_ACCESS_DENIED,
    ),
    summary="제품 보호자 지정. 법정대리인 확인을 대신하지 않는다",
)
async def create_guardian_link(
    profile_id: uuid.UUID,
    req: GuardianLinkCreateRequest,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[GuardianService, Depends(GuardianService)],
) -> ApiResponse[GuardianLinkData]:
    data = await service.assign_product_guardian(account, profile_id, req)
    response.headers["Location"] = f"/api/v1/guardian-links/{data.id}"
    return ApiResponse(data=data, message="보호자 역할을 지정했습니다. 법정대리인 확인은 별도입니다.")


@guardian_router.post(
    "/profiles/{profile_id}/legal-guardian-verifications",
    response_model=ApiResponse[GuardianLinkData],
    status_code=status.HTTP_202_ACCEPTED,
    responses=error_responses(
        *_AUTH,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
        ErrorCode.PROFILE_ACCESS_DENIED,
    ),
    summary="법정대리인 확인 시작. 공급자가 없으면 pending만",
)
async def start_legal_verification(
    profile_id: uuid.UUID,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[GuardianService, Depends(GuardianService)],
) -> ApiResponse[GuardianLinkData]:
    data = await service.start_legal_verification(account, profile_id)
    response.headers["Location"] = f"/api/v1/legal-guardian-verifications/{data.id}"
    return ApiResponse(data=data, message="법정대리인 확인을 접수했습니다. 보호자 체크만으로는 완료되지 않습니다.")


@guardian_router.post(
    "/legal-guardian-verifications/{link_id}/refreshes",
    response_model=ApiResponse[GuardianLinkData],
    responses=error_responses(*_AUTH, ErrorCode.PROFILE_NOT_FOUND, ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED),
    summary="확인 공급자 상태 갱신",
)
async def refresh_legal_verification(
    link_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[GuardianService, Depends(GuardianService)],
) -> ApiResponse[GuardianLinkData]:
    data = await service.refresh_legal_verification(account, link_id)
    return ApiResponse(data=data, message="법정대리인 확인 상태를 갱신했습니다.")


@guardian_router.post(
    "/legal-guardian-verifications/{link_id}/expirations",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(*_AUTH, ErrorCode.PROFILE_NOT_FOUND, ErrorCode.HOUSEHOLD_MASTER_REQUIRED),
    summary="법정대리인 확인 철회·만료",
)
async def expire_legal_verification(
    link_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[GuardianService, Depends(GuardianService)],
) -> Response:
    await service.expire_legal_verification(account, link_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@guardian_router.post(
    "/profiles/{profile_id}/minor-deletion-requests",
    response_model=ApiResponse[MinorDeletionRequestData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.LEGAL_GUARDIAN_REQUIRED,
        ErrorCode.LEGAL_GUARDIAN_UNVERIFIED,
        ErrorCode.MINOR_DELETION_STATE_CONFLICT,
        ErrorCode.PROFILE_ACCESS_DENIED,
    ),
    summary="미성년 프로필 삭제 검토 요청. 즉시 파기하지 않는다",
)
async def create_minor_deletion_request(
    profile_id: uuid.UUID,
    req: MinorDeletionRequestCreate,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[GuardianService, Depends(GuardianService)],
) -> ApiResponse[MinorDeletionRequestData]:
    data = await service.submit_minor_deletion(account, profile_id, req)
    response.headers["Location"] = f"/api/v1/minor-deletion-requests/{data.id}"
    return ApiResponse(data=data, message="삭제 검토를 접수했습니다. 바로 지우지 않습니다.")


@guardian_router.post(
    "/minor-deletion-requests/{request_id}/reviews",
    response_model=ApiResponse[MinorDeletionRequestData],
    responses=error_responses(
        *_AUTH,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.HOUSEHOLD_MASTER_REQUIRED,
        ErrorCode.MINOR_DELETION_STATE_CONFLICT,
    ),
    summary="미성년 삭제 요청 검토. 승인은 휴지통이지 즉시 파기가 아니다",
)
async def review_minor_deletion_request(
    request_id: uuid.UUID,
    req: MinorDeletionReviewRequest,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[GuardianService, Depends(GuardianService)],
) -> ApiResponse[MinorDeletionRequestData]:
    data = await service.review_minor_deletion(account, request_id, req)
    return ApiResponse(data=data, message="삭제 검토 결과를 반영했습니다.")


@guardian_router.post(
    "/minor-deletion-requests/{request_id}/appeals",
    response_model=ApiResponse[MinorDeletionRequestData],
    status_code=status.HTTP_202_ACCEPTED,
    responses=error_responses(
        *_AUTH,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.PROFILE_ACCESS_DENIED,
        ErrorCode.MINOR_DELETION_STATE_CONFLICT,
    ),
    summary="거절된 미성년 삭제 요청 이의",
)
async def appeal_minor_deletion_request(
    request_id: uuid.UUID,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[GuardianService, Depends(GuardianService)],
) -> ApiResponse[MinorDeletionRequestData]:
    data = await service.appeal_minor_deletion(account, request_id)
    return ApiResponse(data=data, message="이의를 접수했습니다.")


@guardian_router.post(
    "/profiles/{profile_id}/privacy-self-determinations",
    response_model=ApiResponse[ProfileData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.ADULT_TRANSITION_NOT_DUE,
        ErrorCode.PROFILE_CLAIM_REQUIRED,
        ErrorCode.CREDENTIALS_INVALID,
        ErrorCode.PROFILE_ACCESS_DENIED,
    ),
    summary="만 14세 개인정보 자기결정 표시. 성년 전환이 아니다",
)
async def create_privacy_self_determination(
    profile_id: uuid.UUID,
    req: PrivacySelfDeterminationRequest,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[GuardianService, Depends(GuardianService)],
) -> ApiResponse[ProfileData]:
    data = await service.mark_privacy_self_determination(account, profile_id, req)
    response.headers["Location"] = f"/api/v1/profiles/{profile_id}"
    return ApiResponse(data=data, message="개인정보 자기결정을 표시했습니다. 성년 전환은 별도입니다.")


@guardian_router.post(
    "/profiles/{profile_id}/civil-majority-transitions",
    response_model=ApiResponse[ProfileData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.ADULT_TRANSITION_NOT_DUE,
        ErrorCode.PROFILE_CLAIM_REQUIRED,
        ErrorCode.CREDENTIALS_INVALID,
        ErrorCode.PROFILE_ACCESS_DENIED,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
    ),
    summary="만 19세 성년 전환. 본인 계정 재인증과 claim만",
)
async def create_civil_majority_transition(
    profile_id: uuid.UUID,
    req: CivilMajorityTransitionRequest,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[GuardianService, Depends(GuardianService)],
) -> ApiResponse[ProfileData]:
    data = await service.complete_civil_majority(account, profile_id, req)
    response.headers["Location"] = f"/api/v1/profiles/{profile_id}"
    return ApiResponse(data=data, message="성년 전환을 반영했습니다. 기존 보호자 공유는 다시 승인해야 합니다.")


@guardian_router.post(
    "/profiles/{profile_id}/guardian-share-reapprovals",
    response_model=ApiResponse[GuardianLinkData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.PROFILE_ACCESS_DENIED,
    ),
    summary="성년 본인이 기존 제품 보호자 공유를 다시 승인",
)
async def create_guardian_share_reapproval(
    profile_id: uuid.UUID,
    req: GuardianShareReapprovalRequest,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[GuardianService, Depends(GuardianService)],
) -> ApiResponse[GuardianLinkData]:
    data = await service.reapprove_guardian_share(account, profile_id, req)
    response.headers["Location"] = f"/api/v1/guardian-links/{data.id}"
    return ApiResponse(data=data, message="보호자 공유를 다시 승인했습니다.")


@guardian_router.post(
    "/profiles/{profile_id}/birth-date-corrections",
    response_model=ApiResponse[BirthDateCorrectionData],
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        *_AUTH,
        ErrorCode.PROFILE_NOT_FOUND,
        ErrorCode.PROFILE_ACCESS_DENIED,
        ErrorCode.CREDENTIALS_INVALID,
        ErrorCode.HOUSEHOLD_MEMBERSHIP_REQUIRED,
    ),
    summary="생년월일 정정. 성년 전환·기록 파기를 대신하지 않는다",
)
async def create_birth_date_correction(
    profile_id: uuid.UUID,
    req: BirthDateCorrectionRequest,
    response: Response,
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    service: Annotated[GuardianService, Depends(GuardianService)],
) -> ApiResponse[BirthDateCorrectionData]:
    data = await service.correct_birth_date(account, profile_id, req)
    response.headers["Location"] = f"/api/v1/birth-date-corrections/{data.id}"
    return ApiResponse(data=data, message="생년월일을 정정했습니다. 성년 전환은 이 요청으로 끝나지 않습니다.")
