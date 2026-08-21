"""규칙 기반 만성질환 판정 엔드포인트.

판정은 `chronic_disease_engine`(PR #4, ts04042-cell)이 한다. 이 라우터는 요청 검증과
봉투 응답만 담당하고 엔진 코드는 건드리지 않는다.

ML 예측 엔드포인트(`/predictions/risk`)와의 차이:

- 이쪽은 **국내 학회 지침의 임계값**을 비교해 5단계 등급을 낸다. 확률이 아니다
- 검사값이 없으면 추정하지 않고 `INSUFFICIENT_DATA`를 돌려준다
- 4개 영역(고혈압·비만·이상지질혈증·당뇨)을 독립적으로 판정한다

무인증·무저장 정책은 ML 엔드포인트와 같다.
"""

from fastapi import APIRouter

from app.core.errors import ErrorCode
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.rule_assessment import DomainAssessment, RuleAssessmentData, RuleAssessmentRequest

rule_assessment_router = APIRouter(prefix="/assessments", tags=["assessments"])

ENGINE_SOURCE = "chronic_disease_engine (AH_05_03 PR #4, ts04042-cell, c6943b14)"


@rule_assessment_router.post(
    "/rules",
    response_model=ApiResponse[RuleAssessmentData],
    responses=error_responses(ErrorCode.VALIDATION_ERROR),
    summary="국내 지침 기반 만성질환 위험 판정 (저장하지 않음)",
    description=(
        "대한고혈압학회·대한비만학회·대한당뇨병학회·한국지질동맥경화학회 지침의 임계값으로 "
        "고혈압·비만·이상지질혈증·당뇨 4개 영역을 독립 판정한다.\n\n"
        "- 확률이 아니라 5단계 등급이다: `NORMAL` / `CAUTION` / `HIGH` / `VERY_HIGH`, "
        "입력이 부족하면 `INSUFFICIENT_DATA`.\n"
        "- 값을 추정하지 않는다. 검사값이 없으면 그 영역은 판정하지 않는다.\n"
        "- 진단이 아니다. `sub_status`가 의학적 구간(예: 고혈압 1기)을 표기하지만 "
        "단일 시점 측정값의 참고 분류일 뿐이다.\n"
        "- 요청 본문은 응답 생성 후 폐기한다."
    ),
)
async def assess_by_rules(payload: RuleAssessmentRequest) -> ApiResponse[RuleAssessmentData]:
    # 엔진을 함수 안에서 불러온다. 앱 기동이 이 패키지 존재에 묶이지 않게 한다.
    from chronic_disease_engine import assess_chronic_disease_risk

    results = assess_chronic_disease_risk(payload.to_profile())
    domains = {name: DomainAssessment(**result) for name, result in results.items()}
    insufficient = [name for name, d in domains.items() if d.risk_level == "INSUFFICIENT_DATA"]

    return ApiResponse(
        data=RuleAssessmentData(
            engine=ENGINE_SOURCE,
            domains=domains,
            evaluated=len(domains) - len(insufficient),
            insufficient=insufficient,
        ),
        message=(
            "국내 지침 기준으로 판정했습니다. 입력값은 저장하지 않았습니다."
            if insufficient
            else "4개 영역을 모두 판정했습니다. 입력값은 저장하지 않았습니다."
        ),
    )
