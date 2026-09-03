"""통합 판정 엔드포인트 — 화면이 붙는 단일 진입점 (ADR-009 §8).

기존 둘과의 관계
----------------
`/predictions/risk` 와 `/assessments/rules` 를 지우지 않는다. 셋의 역할이 다르다.

| 경로 | 누가 쓰나 |
|---|---|
| `POST /assessments/summary` | **화면.** 입력 한 벌 → 질환별 통합 결과 |
| `POST /predictions/risk` | 디버깅·엔진 비교. ML 확률만 |
| `POST /assessments/rules` | 디버깅·엔진 비교. 규칙 판정만 |

앞의 둘은 "어느 엔진이 무엇을 답했는지" 를 따로 보려고 남긴다. 화면이 둘을 각각
부르면 **어느 쪽을 보여줄지** 를 화면이 정하게 되고, 그 판단이 서버에 없다는 것이
ADR-009 가 메우려던 구멍이다.

모델이 없을 때 503 을 내지 않는다
---------------------------------
`/predictions/risk` 는 번들 미적재에 503 을 낸다. ML 밖에 없는 경로라 답할 것이
없기 때문이다. 이쪽은 다르다 — 규칙 엔진과 공개 공식이 여전히 답하므로 화면이
통째로 비는 것보다 **ML 칸만 정보 부족** 이 정확하다. 응답의 `model_available` 이
그 사실을 싣는다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core import config
from app.core.errors import ErrorCode
from app.dependencies.security import require_active_account
from app.dependencies.services import get_rate_limiter
from app.dtos.assessment_summary import (
    AssessmentSummary,
    AssessmentSummaryData,
    AssessmentSummaryRequest,
    DiseaseVerdictOut,
)
from app.dtos.envelope import ApiResponse, error_responses
from app.dtos.rule_assessment import DiseaseRiskAssessment
from app.models import ServiceAccount
from app.services.assessment import assess
from app.services.prediction import DISCLAIMERS
from app.services.rate_limit import RateLimiter
from app.services.risk import RiskModelRegistry, registry

assessment_summary_router = APIRouter(prefix="/assessments", tags=["assessments"])


def get_registry() -> RiskModelRegistry:
    # 재학습 후 컨테이너를 재시작하지 않아도 새 계수가 반영된다. `refresh()` 는
    # 1초 스로틀이 걸려 있어 요청마다 불러도 비용이 없다 (docs/35 §7).
    registry.refresh()
    return registry


@assessment_summary_router.post(
    "/summary",
    response_model=ApiResponse[AssessmentSummaryData],
    responses=error_responses(ErrorCode.VALIDATION_ERROR),
    summary="질환별 통합 판정 — 엔진 중재 포함 (저장하지 않음)",
    description=(
        "온보딩 입력 한 벌을 받아 질환 13칸을 한 번에 판정한다. **질환마다 어느 엔진이 "
        "답할지를 서버가 정한다** (ADR-009 §4).\n\n"
        "- `engine` 이 정본 엔진이다. `E1` 규칙 엔진, `E2` ML, `E3` 공개 공식.\n"
        "- `engine_reason` 이 왜 그 엔진인지를 담는다. 화면이 그대로 읽어 보여줄 수 있다.\n"
        "- `risk_level` 은 규칙 엔진 5단계로 통일돼 있다 — 엔진이 달라도 '주의'가 같은 뜻이다.\n"
        "- 정본이 아닌 ML 확률은 지우지 않고 `reference` 에 남긴다. `superseded_by` 가 "
        "무엇에 밀렸는지를 가리킨다.\n"
        "- ML 은 `VERY_HIGH` 를 내지 않는다. 최고 등급은 측정값이 있을 때만 나온다.\n"
        "- `reference.accuracy`·`reference.rule_anchor` 가 '이 숫자를 얼마나 믿어도 되는지'를 "
        "담는다. AUROC 는 정확도가 아니므로 경보 적중률·발견율을 같이 낸다.\n"
        "- `disease_risks` 는 `verdicts` 의 **전치**다. 저쪽이 '여러 수치 → 이 장기의 현재 "
        "상태'라면 이쪽은 '수치 하나 → 여러 질환의 앞날'이다. **심혈관질환은 이 축에만 있다.**\n"
        "- 요청 본문은 응답 생성 후 폐기한다. DB·Redis·로그에 남기지 않는다."
    ),
)
async def assess_summary(
    payload: AssessmentSummaryRequest,
    models: Annotated[RiskModelRegistry, Depends(get_registry)],
    account: Annotated[ServiceAccount, Depends(require_active_account)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> ApiResponse[AssessmentSummaryData]:
    await limiter.hit(
        "assess-summary",
        str(account.id),
        config.PREDICTION_RATE_LIMIT,
        config.PREDICTION_RATE_WINDOW_SECONDS,
    )

    verdicts, disease_risks, summary, model_available, top_suspects = assess(payload, models)

    # 입력을 몇 개 냈는지. `bmi` 는 계산 필드라 model_fields 에 없고, 키·체중 두
    # 개가 그 하나로 합쳐지므로 하나를 뺀다.
    provided = len(payload.model_dump(include=set(type(payload).model_fields), exclude_none=True)) - 1

    disclaimers = list(DISCLAIMERS)
    if not model_available:
        disclaimers.append("예측 모델이 적재되지 않아 규칙·공식으로만 판정했습니다.")

    return ApiResponse(
        data=AssessmentSummaryData(
            bmi=payload.bmi,
            summary=AssessmentSummary(**summary),
            verdicts=[DiseaseVerdictOut(**vars(v)) for v in verdicts],
            disease_risks={name: DiseaseRiskAssessment(**result) for name, result in disease_risks.items()},
            top_suspects=top_suspects,
            disclaimers=disclaimers,
            inputs_provided=provided,
            inputs_total=len(type(payload).model_fields),
            model_available=model_available,
        ),
        message=(
            f"{summary['evaluated']}개 항목을 판정했습니다. 입력값은 저장하지 않았습니다."
            if summary["evaluated"]
            else "판정에 필요한 값이 부족합니다. 입력값은 저장하지 않았습니다."
        ),
    )
