"""규칙 기반 판정 계약 검증.

판정 로직 자체는 검증하지 않는다. 그건 PR #4 의 몫이고, 여기서 재검증하면 팀원의
엔진을 우리 기대에 맞춰 고치게 된다. 이 파일이 지키는 것은 API 경계다 —
요청 검증, 봉투 응답, 그리고 우리 DTO가 엔진 스키마와 어긋나지 않는지.
"""

from typing import Any

import pytest
from httpx import AsyncClient
from starlette import status

from app.dtos.rule_assessment import RuleAssessmentRequest

FULL: dict[str, Any] = {
    "sex": "M",
    "age": 54,
    "height_cm": 172.0,
    "weight_kg": 82.0,
    "waist_cm": 94.0,
    "systolic_bp": 138.0,
    "diastolic_bp": 88.0,
    "fasting_glucose": 112.0,
    "is_fasting": True,
    "hba1c": 6.1,
    "total_cholesterol": 215.0,
    "ldl_c": 140.0,
    "hdl_c": 44.0,
    "triglycerides": 180.0,
    # lab_staging 이 판정하는 네 영역의 입력. 벤더 엔진은 이 값을 무시한다.
    "creatinine": 1.10,
    "urine_acr": 12.0,
    "ast": 28.0,
    "alt": 36.0,
    "ggt": 58.0,
    "uric_acid": 6.8,
    "hemoglobin": 15.1,
    "smoking": False,
}

# 벤더 엔진이 판정하는 넷과, `app/services/lab_staging.py` 가 붙인 넷.
# 응답은 둘을 구분하지 않는다 — 사용자에게 "누가 짠 코드인가"는 아무 뜻이 없다.
VENDOR_DOMAINS = {"hypertension", "obesity", "dyslipidemia", "diabetes"}
STAGING_DOMAINS = {"kidney", "liver", "fatty_liver", "uric_acid", "anemia"}
DOMAINS = VENDOR_DOMAINS | STAGING_DOMAINS


async def test_full_profile_evaluates_all_domains(authorized_client: AsyncClient) -> None:
    response = await authorized_client.post("/api/v1/assessments/rules", json=FULL)
    assert response.status_code == status.HTTP_200_OK

    data = response.json()["data"]
    assert set(data["domains"]) == DOMAINS
    assert data["evaluated"] == len(DOMAINS)
    assert data["insufficient"] == []
    assert "PR #4" in data["engine"]

    for name, domain in data["domains"].items():
        assert domain["category"] == name
        assert domain["risk_level"] in {"NORMAL", "CAUTION", "HIGH", "VERY_HIGH"}
        # 국내 지침 출처가 결과마다 붙어 있어야 한다.
        assert domain["criteria_reference"]
        assert domain["disclaimer"]


async def test_missing_labs_are_refused_not_guessed(authorized_client: AsyncClient) -> None:
    """검사값이 없으면 추정하지 않는다.

    ML 엔드포인트와 정반대의 행동이고, 그 차이가 두 방식을 비교하는 이유다.
    """
    body = {k: FULL[k] for k in ("sex", "age", "height_cm", "weight_kg", "waist_cm")}
    response = await authorized_client.post("/api/v1/assessments/rules", json=body)
    assert response.status_code == status.HTTP_200_OK

    data = response.json()["data"]
    # 비만은 키·체중·허리둘레만으로 판정된다. 나머지 셋은 검사값이 필요하다.
    assert data["domains"]["obesity"]["risk_level"] != "INSUFFICIENT_DATA"
    # 비만만 키·체중·허리둘레로 판정된다. 나머지 일곱은 전부 검사값이 필요하다.
    assert set(data["insufficient"]) == DOMAINS - {"obesity"}
    for name in data["insufficient"]:
        assert data["domains"][name]["missing_fields"]


async def test_empty_body_is_accepted(authorized_client: AsyncClient) -> None:
    """모든 항목이 선택이므로 빈 요청도 유효하다. 전부 판정 불가로 돌아온다."""
    response = await authorized_client.post("/api/v1/assessments/rules", json={})
    assert response.status_code == status.HTTP_200_OK
    assert response.json()["data"]["evaluated"] == 0


@pytest.mark.parametrize(
    "payload",
    [
        {"systolic_bp": 110, "diastolic_bp": 120},  # 이완기 >= 수축기
        {"age": 200},
        {"hba1c": 30.0},
        {**FULL, "unknown_field": 1},  # extra="forbid"
    ],
)
async def test_invalid_payload_rejected(authorized_client: AsyncClient, payload: dict) -> None:
    response = await authorized_client.post("/api/v1/assessments/rules", json=payload)
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert response.json()["success"] is False


async def test_engine_value_error_does_not_leak_as_500(authorized_client: AsyncClient) -> None:
    """엔진도 혈압 순서를 검사하지만 그쪽 ValueError는 500이 된다.

    경계에서 먼저 막아 422 봉투로 돌려주는지 확인한다.
    """
    response = await authorized_client.post("/api/v1/assessments/rules", json={"systolic_bp": 90, "diastolic_bp": 90})
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_dto_fields_are_subset_of_engine_schema() -> None:
    """우리 DTO를 엔진 스키마에서 베껴 썼으므로 드리프트를 감시한다.

    PR #4 가 필드 이름을 바꾸면 우리 값이 조용히 무시된다 — 엔진 쪽 스키마가
    extra="ignore" 라서 예외도 나지 않는다.
    """
    from app.services.lab_staging import STAGING_FIELDS
    from chronic_disease_engine import HealthProfileInput

    ours = set(RuleAssessmentRequest.model_fields)
    theirs = set(HealthProfileInput.model_fields)
    # 우리가 따로 붙인 영역의 입력은 엔진에 없는 것이 정상이다. 그것만 빼고 본다.
    assert ours - STAGING_FIELDS <= theirs, f"엔진에 없는 필드: {sorted(ours - STAGING_FIELDS - theirs)}"
    # 반대로 우리 필드가 엔진 필드와 겹치면 어느 쪽이 읽는지 모호해진다.
    assert not (STAGING_FIELDS & theirs), f"엔진과 이름이 겹친다: {sorted(STAGING_FIELDS & theirs)}"
    assert STAGING_FIELDS <= ours, "DTO 가 staging 입력을 받지 않는다"
    # 반대 방향은 경고 수준이다. 엔진이 새 입력을 받게 되면 우리도 노출해야 한다.
    assert not (theirs - ours), f"우리가 노출하지 않는 엔진 입력: {sorted(theirs - ours)}"


# PR #4 커밋 c6943b14 원본의 SHA-256. 2026-08-20 에 GitHub 에서 다시 받아 바이트
# 단위로 대조해 확인했다. 재수집하면 이 표와 PROVENANCE.md 를 함께 갱신한다.
VENDORED_SHA256 = {
    "__init__.py": "fb9c4539b4a5fbd1723f8e48e6ab4a7da2ffd04bd874ed768edfe82b0aed7bec",
    "engine.py": "f496b43d4fdae7e01e7264848e8f0ac9eb44c94e06ec64c2142420478564c71d",
    "schemas.py": "311d21a40bdc3abddda64ddab16096969e542dc7a226ebb6996781044d6cfdfd",
    "rules/__init__.py": "1c2fa55a32fda962b637a0cd52b9d68941d53df226e16cc3912ab57c1f31a6e5",
    "rules/diabetes.py": "5346f76f91c1a97274eda9750a489d78fa106463d6c6992e31544172037431e5",
    "rules/dyslipidemia.py": "447af0c508feb0118929c6c7b082e3f6356b8252590f6656e25f192ed989b7b6",
    "rules/hypertension.py": "439b6bf406736e4d76a330888bac5b8782edd18f4d1b0b0f743ca078538c69c6",
    "rules/obesity.py": "b0f7e5931b61f4b9903a329e52cdb6a44c6a7b8373a09e39061af1f972b6b62f",
}


def test_vendored_engine_is_unmodified() -> None:
    """가져온 코드에 우리 손이 들어가지 않았는지 확인한다.

    엔진을 고치면 "팀원의 엔진과 비교"가 아니라 "내가 고친 엔진과 비교"가 된다.
    파일 목록만 보면 안 된다 — `ruff format` 이 따옴표 하나만 바꿔도 판정이 달라질 수
    있고 목록은 그대로다. 내용을 해시로 고정한다.
    """
    import hashlib
    from pathlib import Path

    root = Path(__file__).resolve().parents[3] / "chronic_disease_engine"
    assert (root / "PROVENANCE.md").exists(), "출처 문서가 없다"

    found = {
        str(p.relative_to(root)).replace("\\", "/")
        for p in root.rglob("*.py")
        if p.is_file() and "__pycache__" not in p.parts
    }
    assert found == set(VENDORED_SHA256), f"파일 구성이 PR #4 와 다르다: {found ^ set(VENDORED_SHA256)}"

    for name, expected in VENDORED_SHA256.items():
        actual = hashlib.sha256((root / name).read_bytes()).hexdigest()
        assert actual == expected, (
            f"{name} 이 원본과 다르다. 의도한 재수집이면 PROVENANCE.md 와 VENDORED_SHA256 을 갱신하고, "
            f"아니면 되돌려라. expected={expected[:16]} actual={actual[:16]}"
        )


async def test_rules_response_carries_the_disease_risks(authorized_client: AsyncClient) -> None:
    """봉투에 전치 판정이 실려 나가는지. 라우터에서 빠뜨려도 도메인 판정은 멀쩡해서 안 들킨다."""
    response = await authorized_client.post("/api/v1/assessments/rules", json=FULL)
    assert response.status_code == status.HTTP_200_OK

    risks = response.json()["data"]["disease_risks"]
    from app.services.disease_risk_matrix import DISEASES

    assert set(risks) == set(DISEASES)
    # 이 프로필은 흡연 없음·정상 지질이지만 나이·복부둘레가 걸려 심혈관 신호가 잡힌다.
    assert risks["cvd_risk"]["contributors"], "근거 목록이 비어 있으면 화면에 표가 안 그려진다"
    for entry in risks["cvd_risk"]["contributors"]:
        assert entry["effect"] and entry["source"], "근거 없는 기여 항목이 나갔다"
