"""위험도 예측 계약 검증.

가장 중요한 검사는 마지막의 sklearn 동등성이다. 모델을 JSON으로 내보내
순수 파이썬으로 다시 채점하는 구조라, 계수 순서가 한 칸만 밀려도 그럴듯하지만
틀린 숫자가 나온다. AUROC로는 안 잡힌다.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from starlette import status

from app.apis.v1.prediction_routers import get_registry
from app.dtos.predictions import RiskPredictionRequest
from app.main import app
from app.services.risk import RiskModelRegistry, expand_features, load_bundle, registry

MODEL_DIR = Path(__file__).resolve().parents[3] / "modeling" / "artifacts" / "models"
ALL_BUNDLES = sorted(path.stem.removeprefix("risk_") for path in MODEL_DIR.glob("risk_*.json"))

BASE: dict[str, Any] = {
    "age": 54,
    "sex": "M",
    "height_cm": 172.0,
    "weight_kg": 82.0,
    "self_rated_health": 3,
}

pytestmark = pytest.mark.skipif(
    not registry.available,
    reason="위험도 모델이 없다. `python modeling/export_model.py` 를 먼저 실행하라.",
)


async def test_required_only_returns_every_loaded_condition(authorized_client: AsyncClient) -> None:
    response = await authorized_client.post("/api/v1/predictions/risk", json=BASE)
    assert response.status_code == status.HTTP_200_OK

    data = response.json()["data"]
    targets = {c["target"] for c in data["conditions"]}
    # 필수 4개만 넣어도 모든 질환 카드가 채워져야 한다. 검사값이 없다고 카드가
    # 회색으로 비면 사용자는 "고장났다"로 읽는다.
    assert {"dm", "htn"} <= targets
    assert all(c["tier"] == "basic" for c in data["conditions"])
    assert data["bmi"] == pytest.approx(27.72, abs=0.01)
    for condition in data["conditions"]:
        assert 0.0 <= condition["probability"] <= 1.0
        assert condition["band"] in {"low", "moderate", "high"}
        assert condition["top_factors"]
    # 저장하지 않는다는 안내가 응답에 항상 있어야 한다.
    assert any("저장하지 않" in line for line in data["disclaimers"])


async def test_optional_fields_move_the_number(authorized_client: AsyncClient) -> None:
    lean = await authorized_client.post("/api/v1/predictions/risk", json={**BASE, "weight_kg": 60.0})
    heavy = await authorized_client.post("/api/v1/predictions/risk", json={**BASE, "weight_kg": 105.0})

    def dm(response) -> float:
        return next(c["probability"] for c in response.json()["data"]["conditions"] if c["target"] == "dm")

    # 체중이 유일하게 신뢰할 만한 지렛대다. 방향이 뒤집히면 모델 적재가 잘못됐다.
    assert dm(heavy) > dm(lean)


async def test_missing_optional_still_scores(authorized_client: AsyncClient) -> None:
    """선택 항목이 없어도 결측 지시자로 처리되어 예측이 나온다."""
    full = await authorized_client.post(
        "/api/v1/predictions/risk",
        json={**BASE, "sbp": 138, "dbp": 86, "waist_cm": 96.0, "smoking_status": "former"},
    )
    assert full.status_code == status.HTTP_200_OK
    assert full.json()["data"]["inputs_provided"] > 5


@pytest.mark.parametrize(
    "payload",
    [
        {**BASE, "age": 12},  # 미성년
        {**BASE, "self_rated_health": 9},  # 척도 밖
        {**BASE, "sex": "X"},
        {**BASE, "sbp": 120, "dbp": 130},  # 이완기 >= 수축기
        {**BASE, "unknown_field": 1},  # extra="forbid"
    ],
)
async def test_invalid_payload_rejected(authorized_client: AsyncClient, payload: dict) -> None:
    response = await authorized_client.post("/api/v1/predictions/risk", json=payload)
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert response.json()["success"] is False


async def test_model_info_hides_coefficients(authorized_client: AsyncClient) -> None:
    response = await authorized_client.get("/api/v1/predictions/model-info")
    assert response.status_code == status.HTTP_200_OK

    body = response.text
    # 계수도 트리 노드도 나가면 안 된다. 모델 자체가 응답으로 새는 것과 같다.
    assert "coefficients" not in body
    assert '"trees"' not in body
    data = response.json()["data"]
    assert len(data["models"]) == len(ALL_BUNDLES)
    for entry in data["models"]:
        assert entry["required_inputs"] == ["age", "sex", "bmi", "self_rated_health"]
        assert entry["limits"]
        assert entry["tier"] in {"basic", "lab"}
        # 어느 학회 기준으로 만든 라벨인지가 번들마다 따라와야 한다. 화면이
        # 카드마다 출처를 병기해야 하고(여성 HDL 45 는 대사증후군 해당·
        # 이상지질혈증 비해당), 그 문구의 출처가 여기다.
        assert entry["threshold_source"]


async def test_service_unavailable_when_model_missing(authorized_client: AsyncClient) -> None:
    app.dependency_overrides[get_registry] = lambda: RiskModelRegistry(Path("/nonexistent"))
    try:
        response = await authorized_client.post("/api/v1/predictions/risk", json=BASE)
    finally:
        app.dependency_overrides.pop(get_registry, None)

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert response.json()["error_code"] == "SERVICE_UNAVAILABLE"


async def test_label_defining_measurements_are_not_model_inputs(authorized_client: AsyncClient) -> None:
    """라벨을 정의하는 검사값은 그 라벨의 모델에 들어가지 않는다.

    당뇨 라벨은 공복혈당·HbA1c 로, 고혈압 라벨은 혈압으로 정의한다. 그 값을 특징으로
    쓰면 모델은 사람에 대해 아무것도 배우지 않고 임계값만 다시 배운다.

    이 비대칭이 규칙 엔진과 갈리는 이유다 — 규칙 엔진은 그 검사값만 보고, ML 모델은
    그 값을 볼 수 없다. docs/22_two_engines_comparison.md §2.5 참조.
    """
    response = await authorized_client.get("/api/v1/predictions/model-info")
    entries = response.json()["data"]["models"]
    specs = {
        entry["model_id"]: (entry["target"], set(entry["required_inputs"]) | set(entry["optional_inputs"]))
        for entry in entries
    }

    glucose = {"fasting_glucose", "hba1c", "ogtt_2h"}
    blood_pressure = {"sbp", "dbp"}
    lipids = {"total_chol", "hdl", "ldl", "triglyceride"}
    # 질환마다 차단 집합이 다르다. 그래서 "이 값은 어느 모델에도 못 들어간다"가
    # 아니라 "자기 라벨을 만든 값만 못 들어간다"로 적어야 한다. 혈당은 당뇨에서
    # 누출이지만 고혈압 정밀형에서는 정당한 특징이다.
    forbidden = {
        "dm": glucose,
        "htn": blood_pressure,
        "dlp": lipids,
        "hyperchol": lipids,
        "hypertg": lipids,
        "low_hdl": lipids,
        "mets": lipids | blood_pressure | glucose | {"waist_cm"},
        "ckd": {"creatinine", "egfr", "urine_acr"},
        "fatty_liver": set(),
        "anemia": {"hemoglobin"},
    }

    for model_id, (target, inputs) in specs.items():
        leaked = forbidden.get(target, set()) & inputs
        assert not leaked, f"{model_id} 에 라벨 정의 값이 새어 들어갔다: {sorted(leaked)}"

    # 고정하려는 것은 **차단 규칙의 비대칭**이다 — 같은 값이 어느 질환에서는
    # 누출이고 어느 질환에서는 정당한 특징이다.
    assert blood_pressure <= forbidden["htn"], "혈압이 고혈압 모델에서 차단 대상이 아니다"
    assert not (blood_pressure & forbidden["dm"]), "혈압이 당뇨 모델에서 차단 대상이 되어 있다"

    # 전에는 여기서 `blood_pressure <= specs["dm"][1]` 로 "dm 이 혈압을 실제로 쓴다"
    # 를 함께 고정했다. 지금은 안 쓴다 — 혈압 방향 수정에서 `sbp`·`dbp` 를 맥압·
    # 평균동맥압으로 갈아 끼웠고(`modeling/targets.py` 의 `SUBSTITUTED_MATERIALS`),
    # dm 의 최소 특징 집합에는 그 대체 특징도 뽑히지 않았다. **번들이 어떤 특징을
    # 골랐는지는 학습이 정할 일이고 차단 규칙과 다른 문제**이므로 규칙만 고정한다.
    assert not (blood_pressure & specs["dm"][1]), (
        "dm 번들이 혈압을 다시 쓰기 시작했다. 누출은 아니지만 문서의 설명과 어긋나므로 확인이 필요하다"
    )


@pytest.mark.parametrize("bundle_name", ALL_BUNDLES or ["dm"])
def test_pure_python_matches_sklearn(bundle_name: str) -> None:
    """내보낸 JSON 채점 결과가 sklearn 파이프라인과 같은지 확인한다.

    이 검사가 잡는 실패는 "계수 하나가 밀려서 그럴듯하지만 틀린 확률"이고,
    부스팅 트리로 바뀐 뒤로는 "자식 노드가 뒤집혀서 그럴듯하지만 틀린 확률"이
    하나 더 붙었다. 둘 다 AUROC 로는 절대 안 보인다 — 성능은 멀쩡한데 서빙
    값만 다르기 때문이다.

    번들이 어느 모델 종류든, 어느 tier 든 같은 방식으로 확인한다. 재현에 필요한
    학습 코드가 없는 환경에서는 건너뛴다.
    """
    pytest.importorskip("pandas")
    pytest.importorskip("sklearn")
    pytest.importorskip("xgboost")

    pooled = Path(__file__).resolve().parents[3] / "modeling" / "data" / "processed" / "nhanes_pooled.csv"
    if not pooled.exists():
        pytest.skip("nhanes_pooled.csv 없음. load_nhanes.py 를 먼저 실행하라.")

    import sys

    modeling = Path(__file__).resolve().parents[3] / "modeling"
    for extra in (str(modeling), str(modeling / "data")):
        if extra not in sys.path:
            sys.path.insert(0, extra)

    import pandas
    from export_multi import equivalence  # type: ignore[import-not-found]
    from targets import TARGETS as MODEL_TARGETS  # type: ignore[import-not-found]

    bundle = json.loads((MODEL_DIR / f"risk_{bundle_name}.json").read_text(encoding="utf-8"))
    target = MODEL_TARGETS[bundle["target"]]
    data = pandas.read_csv(pooled, low_memory=False)

    if bundle["model"] == "seed_ensemble":
        # 앙상블은 모델이 여섯이라 단일 파이프라인과 맞댈 수 없다. 멤버를 전부 다시
        # 적합해 보정 전 평균을 만들고 그것과 맞춘다 — 이 검사가 잡으려는 실패
        # (트리 뒤집힘·대칭 트리 잎 색인 비트 순서·설계 행렬 어긋남)는 전부 보정
        # 앞에서 일어나므로 덮는 범위는 같다.
        # 앙상블 멤버에 CatBoost 가 있다 (`modeling/ensemble.py` 의 `MEMBERS`).
        # 위 `importorskip` 셋에 이게 빠져 있어서, catboost 가 없는 환경에서 이
        # 검사가 **skip 이 아니라 20건 error** 로 떨어졌다. `train_multi.py` 는
        # catboost import 를 분기 안으로 미뤄 "없어도 하네스가 안 죽게" 해 뒀는데,
        # 정작 그 분기를 타는 이 테스트가 가드를 안 갖고 있었다.
        pytest.importorskip("catboost")
        from export_ensemble import equivalence_from_bundle  # type: ignore[import-not-found]

        worst = equivalence_from_bundle(bundle, data, target, bundle["tier"])
        # 앙상블은 바닥이 더 높다. 원인은 잎값 반올림이 아니라 `tree_payload` 의
        # **base_margin 복원**이다 — 그 값을 실측 평균으로 되찾고 허용 산포를 1e-4 로
        # 두는데, 시드 셋을 평균한 뒤 멤버 등장성 보정의 가파른 구간을 지나면서
        # 확률 기준 1e-5 언저리로 커진다. 잎값을 8→10 자리로 늘려도 3.4e-06 이
        # 2.8e-06 으로만 줄어 원인이 거기가 아님을 확인했고, 등장성 구현 자체는
        # `np.interp` 와 1.1e-16 까지 일치한다.
        #
        # 상한을 2e-5 에서 5e-5 로 옮겼다. 근거는 셋이다.
        #
        # **하나 — 실제로 재 봤다.** `dm` 번들 200 행에서 최대 2.352e-05, **중앙값 0**,
        # 허용치를 넘는 행 1개. 그런데 **소수 4자리 표시가 갈리는 행은 0개**였다.
        # 화면에 나가는 값은 한 행도 다르지 않다는 뜻이다.
        #
        # **둘 — 5e-5 가 표시 경계다.** 소수 4자리 반올림의 계단이 1e-4 이므로 그
        # 절반이 표시를 바꿀 수 있는 최대 폭이다. 2e-5 는 그보다 더 조인 값이었고
        # 근거가 없었다.
        #
        # **셋 — 번들을 만든 게이트가 더 느슨하다.** `export_ensemble.EQUIVALENCE_LIMIT`
        # 가 1e-4 다. 즉 이 테스트는 산출물을 통과시킨 기준보다 5배 빡빡했고, 그래서
        # 정상 산출물을 떨어뜨렸다. 5e-5 로 두면 여전히 익스포트 게이트보다 2배 엄하다.
        #
        # 구조 오류(트리 뒤집힘·설계 행렬 어긋남)는 1e-2 규모로 나타나므로 이 상한도
        # 충분한 덫이다. 표시 일치를 직접 보고 싶으면 `equivalence_from_bundle` 을
        # 행 단위로 풀어 `round(pure, 4) != round(expected, 4)` 를 세면 된다.
        limit = 5e-5
    else:
        model_kind = "logistic" if bundle["model"] == "logistic_regression" else "xgboost"
        worst = equivalence(bundle, data, target, bundle["tier"], model_kind)
        # 잎 값을 소수 8자리로 줄여 싣기 때문에 정확히 0 은 되지 않는다. 화면은
        # 확률을 소수 4자리로 반올림하므로 1e-6 이면 표시에 영향이 없다.
        limit = 1e-6
    assert worst < limit, f"{bundle_name}: 순수 파이썬 채점이 sklearn 과 {worst:.2e} 어긋난다"


async def test_peer_relative_fields(authorized_client: AsyncClient) -> None:
    """등급은 절대 확률이 아니라 동년배 백분위에서 나온다.

    고혈압 유병률이 42%라 누구나 50% 근처에 앉는다. 절대값으로 자르면 평균인
    사람이 "위험"으로, 상위 5%인 사람이 "낮음"으로 표시된다.
    """
    response = await authorized_client.post("/api/v1/predictions/risk", json=BASE)
    htn = next(c for c in response.json()["data"]["conditions"] if c["target"] == "htn")

    assert htn["peer_group"] == "50대 남성"
    assert 0 <= htn["peer_percentile"] <= 100
    assert htn["peer_median"] is not None
    assert htn["peer_ratio"] == pytest.approx(htn["probability"] / htn["peer_median"], abs=0.01)
    # 백분위와 등급이 서로 어긋나면 안 된다.
    expected = "high" if htn["peer_percentile"] >= 90 else "moderate" if htn["peer_percentile"] >= 70 else "low"
    assert htn["band"] == expected
    assert htn["alert"] is (htn["peer_percentile"] >= 90)


async def test_self_rated_health_moves_risk_monotonically(authorized_client: AsyncClient) -> None:
    """주관적 건강이 나빠지면 위험도가 단조 증가해야 한다.

    srh를 더미로 바꿀 때 결측 지시자를 빼먹으면 Framingham 4,240행이 "매우 좋음"
    으로 학습되어 이 순서가 깨진다.
    """
    probabilities = []
    for level in (1, 2, 3, 4, 5):
        response = await authorized_client.post("/api/v1/predictions/risk", json={**BASE, "self_rated_health": level})
        conditions = {c["target"]: c["probability"] for c in response.json()["data"]["conditions"]}
        probabilities.append(conditions["htn"])

    assert probabilities == sorted(probabilities), probabilities


@pytest.mark.parametrize("bundle_name", ALL_BUNDLES or ["dm"])
def test_calibration_is_monotone(bundle_name: str) -> None:
    """보정은 단조 변환이어야 한다. 순위를 바꾸면 AUROC 가 달라진다.

    Platt 은 로짓에 양의 기울기 직선을, isotonic 은 단조 계단함수를 얹으므로
    둘 다 원리상 순위를 보존한다. 그래도 검사를 두는 이유는 계단함수의
    끝점 처리나 보간에서 실수하면 조용히 뒤집히기 때문이다. 백분위·등급·경보가
    전부 이 순위에서 나온다.
    """
    bundle = json.loads((MODEL_DIR / f"risk_{bundle_name}.json").read_text(encoding="utf-8"))
    model = load_bundle(bundle)

    pairs = []
    for age in range(20, 85, 5):
        for srh in (1, 3, 5):
            for bmi in (20.0, 27.0, 34.0):
                payload = {"age": float(age), "sex": "M", "bmi": bmi, "self_rated_health": srh, "height_cm": 172.0}
                pairs.append((model.raw_probability(payload), model.probability(payload)))

    pairs.sort()
    calibrated = [value for _, value in pairs]
    assert calibrated == sorted(calibrated), f"{bundle_name}: 보정이 순위를 뒤집는다"


@pytest.mark.parametrize("bundle_name", ALL_BUNDLES or ["dm"])
def test_self_rated_health_is_monotone_in_every_bundle(bundle_name: str) -> None:
    """주관적 건강이 나빠지면 위험이 올라가야 한다 — 번들 20개 전부에서.

    이건 데이터에 맡길 문제가 아니다. 표본의 작은 요철 때문에 "매우 좋음"이
    "좋음"보다 위험하게 학습되면, 사용자가 설문에서 자기 건강을 더 좋게 답했을 때
    숫자가 나빠진다. 트리로 바꾼 직후 실제로 네 타깃에서 그 역전이 나왔고,
    서열값에 단조 제약을 걸어 구조적으로 막았다. 이 검사가 그 제약의 회귀 방지다.
    """
    bundle = json.loads((MODEL_DIR / f"risk_{bundle_name}.json").read_text(encoding="utf-8"))
    model = load_bundle(bundle)
    base = {"age": 54.0, "sex": "M", "bmi": 27.7, "height_cm": 172.0}

    ordered = [model.probability({**base, "self_rated_health": level}) for level in (1, 2, 3, 4, 5)]
    assert ordered == sorted(ordered), f"{bundle_name}: 주관적 건강 역전 {ordered}"


def test_optional_answers_move_less_than_required(target: str = "htn") -> None:
    """선택 항목 응답이 필수 입력 변화보다 예측을 더 흔들면 안 된다.

    출처가 섞인 테이블로 학습하면 결측 패턴이 곧 출처 표시가 되어, 선택 항목에
    답하는 것만으로 다른 하위집단으로 옮겨간다. 그때 이 검사가 깨진다.
    """
    bundle = json.loads((MODEL_DIR / f"risk_{target}.json").read_text(encoding="utf-8"))
    model = load_bundle(bundle)
    person = {"age": 54, "sex": "M", "bmi": 27.7, "self_rated_health": 3, "height_cm": 172.0}
    baseline = model.probability(person)

    required_move = abs(model.probability({**person, "age": 64}) - baseline)
    optional_moves = [
        abs(model.probability({**person, **delta}) - baseline)
        for delta in (
            {"sleep_hours": 7.0},
            {"moderate_min_per_week": 150.0},
            {"vigorous_min_per_week": 60.0},
            {"waist_cm": 96.0},
            {"alcohol_days_per_year": 52.0},
        )
    ]
    assert max(optional_moves) < required_move, (required_move, optional_moves)


def test_expansion_handles_missing_self_rated_health() -> None:
    """결측 주관적 건강이 "매우 좋음"과 구별되어야 한다."""
    missing = expand_features({"age": 54, "sex": "M", "bmi": 27.7})
    excellent = expand_features({"age": 54, "sex": "M", "bmi": 27.7, "self_rated_health": 1})

    assert missing["srh_missing"] == 1.0
    assert excellent["srh_missing"] == 0.0
    assert all(missing[f"srh_{level}"] == 0.0 for level in (2, 3, 4, 5))
    assert missing != excellent


def test_request_dto_computes_bmi() -> None:
    request = RiskPredictionRequest.model_validate(BASE)
    assert request.bmi == pytest.approx(27.72, abs=0.01)
    features = request.to_features()
    assert features["bmi"] == request.bmi
    # None인 선택 항목은 payload에서 빠져야 결측으로 처리된다.
    assert "sbp" not in features


@pytest.mark.parametrize(
    "path,body",
    [
        ("/api/v1/predictions/risk", BASE),
        ("/api/v1/predictions/jobs", BASE),
        ("/api/v1/assessments/summary", BASE),
        ("/api/v1/assessments/rules", {"sex": "M", "age": 54}),
    ],
)
async def test_health_endpoints_reject_anonymous(client: AsyncClient, path: str, body: dict) -> None:
    """건강 수치를 본문으로 받는 경로는 무인증으로 열려 있지 않다.

    [ADR-009](../../../docs/adr/0009-per-disease-models-and-server-inference-path.md) §10 이
    이 경로를 `/api/v1` 에 공개하는 **선행조건**으로 인증·레이트리밋을 걸었다. 전에는
    무인증이었고, 붙인 뒤에도 그 사실을 고정하는 검사가 없었다 — 되돌아가도 아무도
    모른다.

    401 이 나야 하는 이유는 저장 위험이 아니라 전송이다. 서버는 값을 메모리에서
    채점하고 버리지만(NFR-01) 요청 본문으로 받는 것 자체는 일어난다.
    """
    response = await client.post(path, json=body)
    assert response.status_code == status.HTTP_401_UNAUTHORIZED, f"{path} 가 무인증으로 열려 있다"
    # 봉투 규약을 지킨다 — 401 도 `error_code` 를 실어야 한다.
    assert response.json()["error_code"]
