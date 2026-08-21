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
    "smoking": False,
}

DOMAINS = {"hypertension", "obesity", "dyslipidemia", "diabetes"}


async def test_full_profile_evaluates_all_domains(client: AsyncClient) -> None:
    response = await client.post("/api/v1/assessments/rules", json=FULL)
    assert response.status_code == status.HTTP_200_OK

    data = response.json()["data"]
    assert set(data["domains"]) == DOMAINS
    assert data["evaluated"] == 4
    assert data["insufficient"] == []
    assert "PR #4" in data["engine"]

    for name, domain in data["domains"].items():
        assert domain["category"] == name
        assert domain["risk_level"] in {"NORMAL", "CAUTION", "HIGH", "VERY_HIGH"}
        # 국내 지침 출처가 결과마다 붙어 있어야 한다.
        assert domain["criteria_reference"]
        assert domain["disclaimer"]


async def test_missing_labs_are_refused_not_guessed(client: AsyncClient) -> None:
    """검사값이 없으면 추정하지 않는다.

    ML 엔드포인트와 정반대의 행동이고, 그 차이가 두 방식을 비교하는 이유다.
    """
    body = {k: FULL[k] for k in ("sex", "age", "height_cm", "weight_kg", "waist_cm")}
    response = await client.post("/api/v1/assessments/rules", json=body)
    assert response.status_code == status.HTTP_200_OK

    data = response.json()["data"]
    # 비만은 키·체중·허리둘레만으로 판정된다. 나머지 셋은 검사값이 필요하다.
    assert data["domains"]["obesity"]["risk_level"] != "INSUFFICIENT_DATA"
    assert set(data["insufficient"]) == {"hypertension", "dyslipidemia", "diabetes"}
    for name in data["insufficient"]:
        assert data["domains"][name]["missing_fields"]


async def test_empty_body_is_accepted(client: AsyncClient) -> None:
    """모든 항목이 선택이므로 빈 요청도 유효하다. 전부 판정 불가로 돌아온다."""
    response = await client.post("/api/v1/assessments/rules", json={})
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
async def test_invalid_payload_rejected(client: AsyncClient, payload: dict) -> None:
    response = await client.post("/api/v1/assessments/rules", json=payload)
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert response.json()["success"] is False


async def test_engine_value_error_does_not_leak_as_500(client: AsyncClient) -> None:
    """엔진도 혈압 순서를 검사하지만 그쪽 ValueError는 500이 된다.

    경계에서 먼저 막아 422 봉투로 돌려주는지 확인한다.
    """
    response = await client.post("/api/v1/assessments/rules", json={"systolic_bp": 90, "diastolic_bp": 90})
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_dto_fields_are_subset_of_engine_schema() -> None:
    """우리 DTO를 엔진 스키마에서 베껴 썼으므로 드리프트를 감시한다.

    PR #4 가 필드 이름을 바꾸면 우리 값이 조용히 무시된다 — 엔진 쪽 스키마가
    extra="ignore" 라서 예외도 나지 않는다.
    """
    from chronic_disease_engine import HealthProfileInput

    ours = set(RuleAssessmentRequest.model_fields)
    theirs = set(HealthProfileInput.model_fields)
    assert ours <= theirs, f"엔진에 없는 필드: {sorted(ours - theirs)}"
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


async def test_one_demo_page_drives_both_engines(client: AsyncClient) -> None:
    """비교는 한 화면에서 되어야 한다.

    화면이 둘이면 엔진을 바꿀 때 입력값이 날아가고, 그러면 같은 사람으로 두 결과를
    나란히 놓을 수가 없다.
    """
    response = await client.get("/api/demo")
    assert response.status_code == status.HTTP_200_OK
    page = response.text

    # 한 화면이 두 엔드포인트를 모두 호출한다.
    assert "/api/v1/predictions/risk" in page
    assert "/api/v1/assessments/rules" in page
    # 엔진 스위치 세 개
    for key in ("ml", "rules", "both"):
        assert f'data-engine="{key}"' in page
    assert "--accent: #0066CC" in page


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("/api/demo", "both"),  # 기본은 둘 다 — 비교가 이 화면의 목적이다
        ("/api/demo?engine=ml", "ml"),
        ("/api/demo?engine=rules", "rules"),
        ("/api/demo/rules", "rules"),  # 화면이 둘이던 시절의 주소
    ],
)
async def test_demo_preselects_engine(client: AsyncClient, url: str, expected: str) -> None:
    response = await client.get(url)
    assert response.status_code == status.HTTP_200_OK
    assert f'let engine = "{expected}"' in response.text
    assert f'data-engine="{expected}" aria-pressed="true"' in response.text


async def test_unknown_engine_is_rejected(client: AsyncClient) -> None:
    response = await client.get("/api/demo?engine=xgboost")
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_demo_form_field_names_exist_in_both_dtos() -> None:
    """공유 폼이 보내는 필드명이 두 요청 모델에 실제로 있는지 확인한다.

    입력 하나를 두 엔진의 다른 필드명으로 갈라 보낸다(`sbp` → `systolic_bp`).
    손으로 쓴 대응표라서 오타 하나면 그 값이 조용히 빠지거나 422가 된다.
    """
    import re

    from app.apis.demo_routers import PAGE
    from app.dtos.predictions import RiskPredictionRequest

    def literal(name: str) -> str:
        match = re.search(rf"const {name} = ([\[{{].*?[\]}}]);", PAGE, re.DOTALL)
        assert match, f"{name} 을 데모 페이지에서 찾지 못했다"
        return match.group(1)

    # ML 은 폼 id 를 그대로 쓴다. 규칙 엔진은 대응표의 값(오른쪽)이 필드명이다.
    ml_sent = set(re.findall(r'"([a-z0-9_]+)"', literal("ML_NUM")))
    ml_sent |= {"sex", "self_rated_health", "smoking_status", "difficulty_walking"}
    rule_sent = set(re.findall(r"[a-z0-9_]+: \"([a-z0-9_]+)\"", literal("RULE_NUM")))
    rule_sent |= set(re.findall(r'"([a-z0-9_]+)"', literal("RULE_BOOL")))
    rule_sent |= {"sex", "smoking"}

    assert ml_sent <= set(RiskPredictionRequest.model_fields), (
        f"ML 모델에 없는 필드를 보낸다: {sorted(ml_sent - set(RiskPredictionRequest.model_fields))}"
    )
    assert rule_sent <= set(RuleAssessmentRequest.model_fields), (
        f"규칙 엔진에 없는 필드를 보낸다: {sorted(rule_sent - set(RuleAssessmentRequest.model_fields))}"
    )
    # 폼이 겹치는 항목을 정말 양쪽에 보내는지 (한쪽만 보내면 비교가 어긋난다)
    assert {"age", "height_cm", "weight_kg", "waist_cm", "sex"} <= ml_sent & rule_sent
    assert "sbp" in ml_sent and "systolic_bp" in rule_sent
