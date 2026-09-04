"""
ChronicDiseaseRiskEngine: 고혈압 / 비만 / 이상지질혈증 / 당뇨 4개 건강영역의
건강위험 및 관리 필요 수준을 Rule 기반으로 독립적으로 판단하는 통합 엔진.

- 4개 영역은 서로 독립적으로 평가하며, 하나의 종합 점수로 합치지 않는다.
- 의료적 진단을 수행하지 않으며, 참고용 건강위험 정보만 제공한다.
"""
from __future__ import annotations

from typing import Any, Union

from .rules import evaluate_diabetes, evaluate_dyslipidemia, evaluate_hypertension, evaluate_obesity
from .schemas import ADULT_CRITERIA_NOTICE, HealthProfileInput


class ChronicDiseaseRiskEngine:
    """4개 만성질환 건강영역을 독립적으로 평가하는 Rule 기반 엔진."""

    def assess(self, profile: Union[HealthProfileInput, dict[str, Any]]) -> dict[str, dict[str, Any]]:
        """사용자 건강정보를 입력받아 4개 영역의 구조화된 건강위험 결과를 반환한다.

        Args:
            profile: HealthProfileInput 인스턴스 또는 동일한 필드를 가진 dict.
                dict로 전달된 경우 Pydantic validation을 거쳐 기술적으로 유효한
                범위인지 확인한다 (건강위험 기준 판단과는 별개).

        Returns:
            {"hypertension": {...}, "obesity": {...}, "dyslipidemia": {...}, "diabetes": {...}}
            형태의 dict. 각 값의 구조는 schemas.DomainResult를 따른다.
        """
        if isinstance(profile, dict):
            profile = HealthProfileInput(**profile)

        results = {
            "hypertension": evaluate_hypertension(profile),
            "obesity": evaluate_obesity(profile),
            "dyslipidemia": evaluate_dyslipidemia(profile),
            "diabetes": evaluate_diabetes(profile),
        }

        if profile.age is not None and profile.age < 19:
            for result in results.values():
                if ADULT_CRITERIA_NOTICE not in result.flags:
                    result.flags.append(ADULT_CRITERIA_NOTICE)

        return {name: result.model_dump() for name, result in results.items()}


def assess_chronic_disease_risk(
    profile: Union[HealthProfileInput, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """ChronicDiseaseRiskEngine 사용을 위한 함수형 진입점."""
    return ChronicDiseaseRiskEngine().assess(profile)
