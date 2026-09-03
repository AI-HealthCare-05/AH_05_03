"""Score the exported logistic-regression risk model in pure Python.

The model arrives as JSON from ``modeling/export_model.py``: feature order,
imputation medians, standardisation constants, one-hot categories, coefficients.
Scoring it is a dot product, so the API needs no scikit-learn, no numpy and no
pandas — which keeps the image small and removes any chance of a library version
changing a prediction under us.

Every field is optional. A missing value is filled with the training median and
flagged with the same missingness indicator the model was trained with, so a
partially filled form still produces a calibrated-ish number rather than an
error. ``required_inputs`` from the bundle is what the API enforces, and that is
a product decision, not a mathematical one.
"""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path
from typing import Any

# Where the compose file mounts modeling/artifacts/models.
DEFAULT_MODEL_DIR = Path("/app/models")
# Fallback for running uvicorn straight from the repo.
REPO_MODEL_DIR = Path(__file__).resolve().parents[2] / "modeling" / "artifacts" / "models"

MISSING_CATEGORY = "__missing__"

# 특징 확장 경계. modeling/refine.py 가 측정한 "+bins" 구성이다. AUROC는 거의
# 그대로인데 ECE가 절반 이하로 떨어진다 — 화면에 확률을 띄우려면 순위보다
# 확률의 정확도가 중요하다.
AGE_EDGES = [19, 30, 40, 50, 60, 70, 200]
BMI_EDGES = [0, 23, 25, 30, 35, 100]
SRH_LEVELS = [2, 3, 4, 5]

# 동일 연령·성별 비교에 쓰는 구간. 참조표의 키와 같아야 한다.
PEER_AGE_EDGES = [19, 30, 40, 50, 60, 70, 200]

# 검사값에서 만드는 파생 비율. 이름 -> (분자, 분모).
#
# 두 값을 따로 넣는 것보다 비율이 나은 경우가 있다. TG/HDL 은 인슐린 저항성
# 대리 지표이고, 허리/키는 같은 BMI 안에서 복부비만을 가른다. 선형 모델은
# 두 항의 곱이나 비를 스스로 만들지 못하므로 여기서 만들어 준다.
#
# 목록은 modeling/targets.py 의 DERIVED 와 같아야 한다. 다르면 학습 때 있던
# 특징이 서빙에서 사라지고, 그 자리는 조용히 중앙값으로 채워진다.
DERIVED_RATIOS: dict[str, tuple[str, str]] = {
    "tg_hdl_ratio": ("triglyceride", "hdl"),
    "non_hdl": ("total_chol", "hdl"),
    "ast_alt_ratio": ("ast", "alt"),
    "waist_height_ratio": ("waist_cm", "height_cm"),
}
# 뺄셈으로 만드는 것. 나머지는 나눗셈이다.
DERIVED_DIFFERENCES = {"non_hdl"}


def to_float32(value: float) -> float:
    """float64 값을 float32 로 반올림한 결과를 float64 로 돌려준다.

    XGBoost 는 내부에서 특징을 float32 로 들고 분기 조건도 float32 로 비교한다.
    우리가 float64 로 비교하면 경계에 정확히 걸린 값에서 갈라진다 — 실제로
    갈라졌다. 어떤 행에서 조건 -0.319979221 과 값 -0.3199792299 를 비교하는데,
    float32 로는 같은 수이고 float64 로는 값이 더 작다. 트리 하나가 반대편
    잎으로 가고 로그오즈가 0.27 어긋난다.

    번들의 임계값도 내보낼 때 같은 반올림을 거치므로, 양변이 모두 float32 로
    정확히 표현되는 수가 되어 비교 결과가 XGBoost 와 일치한다.
    """
    return struct.unpack("<f", struct.pack("<f", value))[0]


def _band_label(edges: list[int], value: float) -> str:
    for low, high in zip(edges[:-1], edges[1:], strict=True):
        if low <= value < high:
            return f"{low}_{high}"
    return f"{edges[-2]}_{edges[-1]}"


def derive_ratios(payload: dict[str, Any]) -> dict[str, float]:
    """재료가 둘 다 있을 때만 파생값을 만든다.

    하나라도 비면 키 자체를 넣지 않는다. 0.0 을 넣으면 "측정했더니 0"과
    "안 쟀다"가 같은 값이 되고, 검사값을 안 낸 사용자가 극단값으로 채점된다.
    분모가 0 이하인 경우도 같다 — 검사 결과에 0 이 오는 건 값이 아니라 미측정이다.
    """
    out: dict[str, float] = {}
    for name, (first, second) in DERIVED_RATIOS.items():
        left, right = payload.get(first), payload.get(second)
        if left is None or right is None:
            continue
        left, right = float(left), float(right)
        if name in DERIVED_DIFFERENCES:
            out[name] = left - right
        elif right > 0:
            out[name] = left / right
    return out


def egfr_ckd_epi_2021(creatinine: float, age: float, sex: str) -> float:
    """CKD-EPI 2021 race-free 사구체여과율 추정식 (mL/min/1.73m²).

    ``modeling/data/load_nhanes.py`` 의 ``_egfr`` 과 같은 식이어야 한다. 학습
    데이터는 적재 시점에 이 값을 계산해 두고 서빙은 여기서 계산하므로, 둘이
    갈라지면 사용자만 다른 척도로 채점된다. `app/tests` 에 대조 검사가 있다.
    """
    female = sex == "F"
    kappa = 0.7 if female else 0.9
    alpha = -0.241 if female else -0.302
    ratio = creatinine / kappa
    value = 142.0 * min(ratio, 1.0) ** alpha * max(ratio, 1.0) ** -1.200 * 0.9938**age
    return value * 1.012 if female else value


def expand_features(payload: dict[str, Any], expansion: str = "+bins") -> dict[str, Any]:
    """원본 입력을 모델이 학습한 확장 특징으로 바꾼다.

    학습과 서빙이 이 함수 하나를 공유한다. 두 벌로 두면 언젠가 갈라지고,
    갈라진 순간 AUROC로는 잡히지 않는 조용한 오차가 생긴다.

    ``expansion`` 이 세 갈래인 이유
    ------------------------------
    ==================  ==============================================
    ``"ratios"``        파생 비율만. 부스팅 트리용
    ``"+bins+ratios"``  연령·BMI 구간 더미 + 파생 비율. 로지스틱용
    ``"+bins"``         위에 주관적 건강 5더미까지. **구 번들 전용**
    ==================  ==============================================

    구간 더미는 **선형 모델을 위한 장치**다. 로지스틱 회귀는 나이를 직선으로만
    읽으므로 꺾이는 지점을 사람이 미리 잘라 줘야 하고, `modeling/refine.py` 가
    그렇게 해서 ECE 를 절반으로 줄였다. 부스팅 트리는 그 지점을 스스로 찾으므로
    같은 더미가 도움이 되지 않는다.

    주관적 건강 더미는 두 모델 모두에서 뺐다. **1~5 사이의 순서 정보가 사라지기
    때문**이다. 순서를 잃으면 표본의 작은 요철이 그대로 학습되어 "건강이 매우
    좋다"가 "좋다"보다 위험한 모델이 나온다 — 트리에서 네 타깃, 로지스틱에서
    한 타깃이 실제로 그렇게 나왔다(고중성지방혈증 정밀형의 계수가 srh_3 0.080 >
    srh_4 0.054 였다). 서열값 하나로 두면 트리는 단조 제약으로, 로지스틱은
    계수 부호 하나로 역전을 막을 수 있다.
    """
    out = dict(payload)
    bins = "bins" in expansion
    # 주관적 건강 5더미는 구 번들("+bins")에만 남긴다. 아래 설명 참조.
    srh_dummies = expansion == "+bins"
    srh = out.get("self_rated_health")

    # srh_missing 은 어느 구성에서나 있어야 한다. 더미만 두면 결측일 때 전부 0이
    # 되어 "매우 좋음"과 구별이 사라진다. Framingham 4,240행에 이 값이 없으므로
    # 그 행들이 조용히 "매우 좋음"으로 학습된다.
    out["srh_missing"] = 1.0 if srh is None else 0.0

    if srh_dummies:
        out.pop("self_rated_health", None)
        for level in SRH_LEVELS:
            out[f"srh_{level}"] = 1.0 if srh is not None and int(srh) == level else 0.0

    if bins:
        age = payload.get("age")
        for low, high in zip(AGE_EDGES[:-1], AGE_EDGES[1:], strict=True):
            out[f"age_{low}_{high}"] = 1.0 if age is not None and low <= float(age) < high else 0.0

        bmi = payload.get("bmi")
        for low, high in zip(BMI_EDGES[:-1], BMI_EDGES[1:], strict=True):
            out[f"bmi_{low}_{high}"] = 1.0 if bmi is not None and low <= float(bmi) < high else 0.0

    # eGFR 은 학습 테이블에 이미 컬럼으로 있다. 서빙에서는 크레아티닌만 받으므로
    # 없을 때만 계산한다 — 있는 값을 덮어쓰면 학습과 서빙이 다른 반올림을 탄다.
    if out.get("egfr") is None:
        creatinine, age_value, sex = payload.get("creatinine"), payload.get("age"), payload.get("sex")
        if creatinine is not None and age_value is not None and sex in ("M", "F"):
            out["egfr"] = egfr_ckd_epi_2021(float(creatinine), float(age_value), str(sex))

    out.update(derive_ratios(payload))
    return out


def peer_cell(age: float, sex: str) -> str:
    return f"{sex}:{_band_label(PEER_AGE_EDGES, float(age))}"


class BaseRiskModel:
    """번들 하나. 설계 행렬을 만드는 일까지가 여기, 점수를 내는 일은 하위 클래스.

    로지스틱과 부스팅 트리는 마지막 한 단계만 다르다. 결측 대치·표준화·원핫은
    두 모델이 완전히 같은 코드를 통과해야 하고, 그래서 그 부분이 이 클래스에 있다.
    두 벌로 두면 한쪽 전처리만 고치는 순간 예측이 조용히 갈라진다.
    """

    kind = "base"

    def __init__(self, bundle: dict[str, Any]) -> None:
        self.target: str = bundle["target"]
        self.description: str = bundle["description"]
        self.numeric: list[str] = bundle["numeric_features"]
        self.categorical: list[str] = bundle["categorical_features"]
        self.required: list[str] = bundle["required_inputs"]
        self.optional: list[str] = bundle["optional_inputs"]
        self.medians: list[float] = bundle["medians"]
        self.mean: list[float] = bundle["scaler_mean"]
        self.scale: list[float] = bundle["scaler_scale"]
        self.indicator_features: list[str] = bundle["indicator_features"]
        self.categories: dict[str, list[str]] = bundle["categories"]
        self.bands: dict[str, float] = bundle["bands"]
        # Platt 보정. 로짓에 선형 변환을 걸어 확률만 옮긴다. 단조 변환이라
        # AUROC는 그대로고 ECE와 보정 기울기만 좋아진다.
        self.platt: dict[str, float] = bundle.get("platt", {"a": 1.0, "b": 0.0})
        # cell -> 21분위 확률 배열(0,5,...,100%). 동일 연령·성별 대비 위치를 낸다.
        self.reference: dict[str, list[float]] = bundle.get("reference", {})
        self.holdout: dict[str, Any] = bundle["holdout"]
        self.limits: list[str] = bundle["limits"]
        self.created_at: str = bundle["created_at"]

        # 아래는 다질환 번들에만 있는 필드. 구 번들도 그대로 읽히도록 get 을 쓴다.
        self.tier: str = bundle.get("tier", "basic")
        self.name: str = bundle.get("name", self.target)
        self.definition: str = bundle.get("label_definition_text", "")
        self.threshold_source: str = bundle.get("threshold_source", "")
        self.population: str = bundle.get("population", "US NHANES adults")
        # 지금은 전부 유병 라벨이다. 발병 라벨로 갈아탈 때 probability 의 뜻이
        # 조용히 바뀌는 사고를 막으려고 지금 넣어 둔다.
        self.expansion: str = bundle.get("expansion", "+bins")
        # 규칙 엔진 대조 앵커. engine_agreement.py 가 써 넣는다. 없어도 동작한다.
        self.rule_anchor: dict[str, Any] = bundle.get("rule_anchor", {})
        # 기계가 읽는 진단 기준. 없으면 빈 목록이고 판정도 하지 않는다.
        self.criteria: list[dict[str, Any]] = bundle.get("criteria", [])
        # 지표 묶음 전체. 화면은 이 중 몇 개만 쓰지만 나머지도 /model-info 로 나간다.
        self.performance: dict[str, Any] = bundle.get("performance", {})
        self.performance_undiagnosed: dict[str, Any] = bundle.get("performance_undiagnosed") or {}
        self.label_kind: str = bundle.get("label_kind", "prevalent")
        self.horizon_years: float | None = bundle.get("horizon_years")

    @property
    def model_id(self) -> str:
        """레지스트리 키. basic tier 는 기존 이름을 그대로 쓴다."""
        return self.target if self.tier == "basic" else f"{self.target}_{self.tier}"

    def _one_hot_width(self) -> int:
        # OneHotEncoder(drop="first") emits one column per category after the first.
        return sum(max(len(values) - 1, 0) for values in self.categories.values())

    def design_width(self) -> int:
        return len(self.numeric) + len(self.indicator_features) + self._one_hot_width()

    def design_names(self) -> list[str]:
        return [
            *self.numeric,
            *[f"{c}_missing" for c in self.indicator_features],
            *[f"{c}={v}" for c, values in self.categories.items() for v in values[1:]],
        ]

    def design_row(self, raw_payload: dict[str, Any]) -> list[float]:
        """Build the model's input row in exactly the training column order.

        The numeric sub-pipeline is impute-then-scale, and the imputer appends the
        missingness indicators *before* the scaler runs. So the indicators get
        standardised too, and ``scaler_mean`` is longer than ``numeric_features``.
        Leaving them as raw 0/1 silently shifts every prediction.
        """
        payload = expand_features(raw_payload, self.expansion)

        # 1. imputed numeric values, then the indicators, in the imputer's order
        raw_values: list[float] = []
        for index, column in enumerate(self.numeric):
            given = payload.get(column)
            raw_values.append(self.medians[index] if given is None else float(given))
        for column in self.indicator_features:
            raw_values.append(1.0 if payload.get(column) is None else 0.0)

        # 2. standardise the whole numeric block, indicators included
        row = [(value - self.mean[index]) / (self.scale[index] or 1.0) for index, value in enumerate(raw_values)]

        # 3. one-hot, first category dropped
        for column, values in self.categories.items():
            given = payload.get(column)
            given = MISSING_CATEGORY if given is None else str(given)
            for value in values[1:]:
                row.append(1.0 if given == value else 0.0)

        return row

    @staticmethod
    def _sigmoid(value: float) -> float:
        # Guard the exponential so a wild input cannot raise OverflowError.
        return 1.0 / (1.0 + math.exp(-max(-60.0, min(60.0, value))))

    def raw_logit(self, payload: dict[str, Any]) -> float:
        """보정 전 로그오즈. 하위 클래스가 구현한다."""
        raise NotImplementedError

    def raw_probability(self, payload: dict[str, Any]) -> float:
        """Uncalibrated output. Only the equivalence test should need this."""
        return self._sigmoid(self.raw_logit(payload))

    def probability(self, payload: dict[str, Any]) -> float:
        """Calibrated probability — the number a screen may show."""
        return self._sigmoid(self.platt["a"] * self.raw_logit(payload) + self.platt["b"])

    def peer_percentile(self, probability: float, age: float, sex: str) -> float | None:
        """동일 연령·성별 집단에서 이 확률이 몇 번째인가 (0~100).

        고혈압 유병률이 42%라 절대 확률은 누구나 40~60% 근처에 앉는다. 그 숫자를
        그대로 보여주면 "동전 던지기"로 읽히지만 실제 뜻은 "평균 수준"이다.
        같은 나이·성별과 비교한 위치가 사용자가 실제로 알고 싶은 값이다.
        """
        quantiles = self.reference.get(peer_cell(age, sex))
        if not quantiles:
            return None
        step = 100.0 / (len(quantiles) - 1)
        if probability <= quantiles[0]:
            return 0.0
        for index in range(1, len(quantiles)):
            if probability <= quantiles[index]:
                low, high = quantiles[index - 1], quantiles[index]
                span = high - low
                inside = 0.0 if span <= 0 else (probability - low) / span
                return round((index - 1 + inside) * step, 1)
        return 100.0

    def peer_median(self, age: float, sex: str) -> float | None:
        quantiles = self.reference.get(peer_cell(age, sex))
        if not quantiles:
            return None
        return quantiles[len(quantiles) // 2]

    #: AUROC 등급 경계. 임의로 정한 것이 아니라 진단검사 문헌의 관용 구간이다.
    AUROC_GRADES = ((0.90, "뛰어남"), (0.80, "좋음"), (0.70, "쓸 만함"), (0.60, "낮음"))

    def accuracy(self) -> dict[str, Any]:
        """화면에 띄울 정확도 묶음.

        AUROC 하나만 내지 않는 이유가 둘이다.

        **AUROC 는 "정확도"가 아니다.** 위험한 사람과 아닌 사람을 무작위로 한 명씩
        뽑았을 때 위험한 쪽에 더 높은 점수를 줄 확률이다. 100명 중 87명을 맞힌다는
        뜻이 아니고, 그렇게 읽히면 성능을 과대평가하게 된다. 그래서 경보 운영점의
        적중률(PPV)과 발견율(민감도)을 같이 낸다 — 이쪽이 사용자가 실제로 겪는 값이다.

        **이미 진단받은 사람을 맞히는 건 쉽다.** 제품이 찾아야 하는 사람은 자기가
        그 질환인 줄 모르는 사람이고, 그 집합에서 다시 잰 값이 있으면 그걸 화면
        숫자로 쓴다. `docs/23_multi_disease_model_design.md` §4 의 결정이다.
        """
        auroc = float(self.holdout.get("auroc_nhanes", 0.0))
        undiagnosed = self.performance_undiagnosed.get("auroc")
        headline = float(undiagnosed) if undiagnosed is not None else auroc
        grade = next((label for edge, label in self.AUROC_GRADES if headline >= edge), "거의 없음")

        top10 = (self.performance.get("operating_points") or {}).get("top_10pct") or {}
        return {
            "auroc": round(auroc, 3),
            "auroc_undiagnosed": round(float(undiagnosed), 3) if undiagnosed is not None else None,
            "headline_auroc": round(headline, 3),
            "grade": grade,
            "measured_on": "미진단자" if undiagnosed is not None else "전체",
            "alert_ppv": top10.get("ppv"),
            "alert_sensitivity": top10.get("sensitivity"),
            "holdout_n": self.performance.get("n"),
            "holdout_cycle": self.holdout.get("cycle"),
        }

    def judge(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        """입력된 검사값을 진단 기준과 직접 대조한다.

        왜 확률과 따로 있어야 하나
        --------------------------
        라벨을 만드는 검사값은 그 질환의 ML 입력에서 차단된다. 정당한 조치이고
        바꿀 생각도 없다 — 안 그러면 모델이 사람에 대해 아무것도 배우지 않고
        임계값만 다시 배운다.

        문제는 화면이다. 사용자가 혈색소 10.6 을 입력하면 답은 이미 나와 있는데,
        빈혈 모델은 그 값을 볼 수 없으므로 초록색 "낮음"을 띄운다. **답을 확정하는
        값을 넣었는데 화면이 안심시키는 것**이고, 이건 선별 제품에서 가장 비싼
        종류의 오류다.

        그래서 검사값이 들어온 순간 이 판정이 정본이 되고 확률은 참고로 내려간다.
        규칙 엔진(`chronic_disease_engine/`)이 다루는 네 영역은 그쪽이 더 자세한
        판정(전단계·1기·2기)을 내므로 그쪽을 먼저 읽고, 여기 판정은 규칙 엔진에
        대응 영역이 없는 질환에서 그 자리를 메운다.

        판정할 값이 하나도 안 들어오면 ``None`` 이다 — 그때는 확률이 정본이다.
        """
        if not self.criteria:
            return None

        # 확장을 먼저 태운다. eGFR 은 사용자가 넣는 값이 아니라 크레아티닌·나이·
        # 성별에서 계산되는 값이라, 원본 입력만 보면 신기능 기준을 영영 못 만난다.
        payload = expand_features(payload, self.expansion)
        sex = str(payload.get("sex", ""))
        checked: list[dict[str, Any]] = []
        for criterion in self.criteria:
            given = payload.get(criterion["field"])
            if given is None:
                continue
            by_sex = criterion.get("by_sex")
            threshold = by_sex.get(sex) if by_sex else criterion.get("value")
            if threshold is None:
                continue
            value = float(given)
            operator = criterion["op"]
            met = (
                value >= threshold if operator == ">=" else value > threshold if operator == ">" else value < threshold
            )
            checked.append(
                {
                    "label": criterion["label"],
                    "unit": criterion["unit"],
                    "value": round(value, 2),
                    "threshold": threshold,
                    "op": operator,
                    "met": met,
                }
            )

        if not checked:
            return None
        return {
            "met": any(item["met"] for item in checked),
            "checked": checked,
            "source": self.threshold_source,
            "definition": self.definition,
        }

    def interpret(self, probability: float) -> dict[str, Any] | None:
        """이 확률을 받은 사람들을 실제로 검사하면 규칙 엔진이 뭐라고 했는가.

        확률 하나만으로는 읽을 수 없다. 고혈압 유병률이 41%라 평범한 50대 남성이
        47%를 받고, 사용자에게는 "반반"으로 읽히지만 실제 뜻은 "동년배 평균"이다.
        백분위를 붙여도 여전히 추상적이다 — "상위 36%"가 좋은 건지 나쁜 건지는
        여전히 모른다.

        앵커 표는 그 자리를 메운다. `modeling/engine_agreement.py` 가 검사값을
        가진 NHANES 행에 규칙 엔진(국내 학회 임계값)을 돌려서, ML 확률 구간마다
        '주의' 이상을 받은 비율을 세어 뒀다. 그러면 화면에 이렇게 쓸 수 있다 —
        "이 확률대의 사람 100명을 실제로 검사했을 때 62명이 기준을 넘었습니다."

        전체 평균 대비 배수(``lift``)를 같이 낸다. 규칙 엔진의 '주의'는 전단계를
        포함해서 기저율 자체가 50%를 넘는 경우가 있고, 그때 "62%"만 보여주면
        평균보다 나쁜지 좋은지를 또 알 수 없기 때문이다.
        """
        anchor = self.rule_anchor
        bins = anchor.get("bins") if anchor else None
        if not bins:
            return None

        chosen = next((entry for entry in bins if probability <= entry["upper"]), bins[-1])
        baseline = anchor.get("overall_rate")
        rate = chosen["rule_positive_rate"]
        return {
            "society": anchor.get("society"),
            "rule_domain": anchor.get("domain"),
            "positive_from": anchor.get("positive_from"),
            "band_upper": chosen["upper"],
            "sample": chosen["n"],
            "rule_positive_rate": rate,
            "overall_rate": baseline,
            "lift": round(rate / baseline, 2) if baseline else None,
            "levels": chosen["levels"],
        }

    #: 의학 기준 등급 경계. "이 점수대의 사람 중 실제로 기준을 넘는 비율"에 건다.
    MEDICAL_LEVELS = ((0.75, "높음"), (0.50, "주의"), (0.25, "관심"))

    def medical_band(self, probability: float) -> dict[str, Any]:
        """나이 비교가 아니라 의학 기준으로 등급을 정한다.

        동년배 백분위를 등급에 쓰면 안 되는 이유
        ----------------------------------------
        만성질환 유병률은 나이를 따라 오른다. 그래서 동년배와 비교하면 **70대에서
        실제 위험이 높은 사람도 "동년배 이하"** 가 되고, 배지가 초록색으로 뜬다.
        비교 자체는 맞지만 사용자가 읽는 뜻은 "괜찮다"이고, 그건 틀렸다.

        무엇으로 대신하는가
        -------------------
        같은 단위 하나로 통일한다 — **이 점수대의 사람 100명을 실제로 검사하면
        몇 명이 학회 기준을 넘는가.**

        * 규칙 엔진에 대응 영역이 있으면(당뇨·고혈압·이상지질혈증) 그 엔진이 실제로
          판정한 비율을 쓴다. 국내 학회 임계값이고 전단계를 포함한다
        * 없으면 보정된 확률 자체가 그 비율이다. 라벨이 곧 의학 기준(KDIGO·WHO·
          학회 컷오프)이고, 모든 번들이 out-of-fold isotonic 보정을 거쳐 ECE 가
          0.05 아래다. 보정된 확률은 "그 기준을 넘을 비율"과 같은 뜻이다

        나이는 사라지지 않는다. 모델 입력에 그대로 있고 확률에 반영된다. 사라지는
        것은 **나이로 나눠 준 뒤 비교하는 단계**뿐이다.
        """
        anchor = self.interpret(probability)
        if anchor:
            rate, basis = anchor["rule_positive_rate"], f"{anchor['society']} 기준 '주의' 이상"
            baseline = anchor.get("overall_rate")
        else:
            rate, basis = probability, "진단 기준 충족"
            baseline = self.holdout.get("base_rate_nhanes")

        level = next((label for edge, label in self.MEDICAL_LEVELS if rate >= edge), "낮음")
        return {
            "level": level,
            "rate": round(float(rate), 4),
            "basis": basis,
            "baseline": round(float(baseline), 4) if baseline is not None else None,
            "lift": round(rate / baseline, 2) if baseline else None,
            "anchored_on_rule_engine": anchor is not None,
        }

    def band(self, probability: float, percentile: float | None = None) -> str:
        """등급은 백분위로 정한다. 절대 확률로 자르면 기저율에 끌려간다.

        고혈압에서 50%는 "낮음"이 맞는데도 사용자에게는 위험해 보인다. 반대로
        당뇨에서 30%는 상위 5%인데 절대값만 보면 낮아 보인다. 둘 다 같은 문제다.
        """
        if percentile is not None:
            if percentile >= 90:
                return "high"
            if percentile >= 70:
                return "moderate"
            return "low"
        # 참조표가 없을 때만 홀드아웃 분포로 되돌아간다.
        if probability >= self.bands["high_above"]:
            return "high"
        if probability >= self.bands["moderate_above"]:
            return "moderate"
        return "low"

    def contributions(self, raw_payload: dict[str, Any]) -> list[tuple[str, float]]:
        """Per-feature contribution to the log-odds, largest magnitude first."""
        raise NotImplementedError


class RiskModel(BaseRiskModel):
    """로지스틱 회귀 번들. 점수는 설계 행 하나와의 내적이다."""

    kind = "logistic_regression"

    def __init__(self, bundle: dict[str, Any]) -> None:
        super().__init__(bundle)
        self.coefficients: list[float] = bundle["coefficients"]
        self.intercept: float = bundle["intercept"]

        expected = self.design_width()
        if expected != len(self.coefficients):
            raise ValueError(f"{self.target}: 설계 행렬 {expected}열과 계수 {len(self.coefficients)}개가 맞지 않습니다")

    def raw_logit(self, payload: dict[str, Any]) -> float:
        row = self.design_row(payload)
        return self.intercept + sum(w * x for w, x in zip(self.coefficients, row, strict=True))

    def contributions(self, raw_payload: dict[str, Any]) -> list[tuple[str, float]]:
        """Per-feature contribution to the log-odds, largest magnitude first.

        Useful for "what pushed this number up", but read
        docs/20_prediction_inputs_and_levers.md before turning it into advice:
        several behaviours point the wrong way in this data.
        """
        row = self.design_row(raw_payload)
        names = self.design_names()
        pairs = [(name, w * x) for name, w, x in zip(names, self.coefficients, row, strict=True) if abs(w * x) > 1e-9]
        return sorted(pairs, key=lambda item: abs(item[1]), reverse=True)


class TreeRiskModel(BaseRiskModel):
    """부스팅 트리 번들. 순수 파이썬 트리 순회로 점수를 낸다.

    왜 트리를 서빙하나
    ------------------
    검사값을 특징으로 넣은 뒤 로지스틱과 GBDT 의 격차가 커졌다. 검사값 없이는
    두 모델이 사실상 같았지만(EXPERIMENTS_REPORT.md 4장), 검사값이 들어오면
    나이·간효소·요산의 비선형과 상호작용이 살아나 GBDT 가 앞선다. 고LDL 은
    AUROC 0.690 -> 0.740 으로 벌어진다.

    왜 그래도 라이브러리를 안 싣나
    ------------------------------
    번들에는 노드 배열만 들어간다. 순회는 부등호 비교뿐이라 xgboost 버전이
    바뀌어도 예측이 흔들리지 않는다. 계수 내적을 쓰던 이유가 그대로 유지된다.

    노드 표현은 ``[feature_index, threshold, left, right, value]`` 다섯 칸이고,
    ``feature_index`` 가 -1 이면 잎이다. XGBoost 와 같은 ``x < threshold -> left``
    규칙을 쓴다.
    """

    kind = "gradient_boosted_trees"

    LEAF = -1

    def __init__(self, bundle: dict[str, Any]) -> None:
        super().__init__(bundle)
        self.trees: list[list[list[float]]] = bundle["trees"]
        self.base_margin: float = bundle["base_margin"]

        width = self.design_width()
        for tree in self.trees:
            for node in tree:
                index = int(node[0])
                if index != self.LEAF and not 0 <= index < width:
                    raise ValueError(f"{self.target}: 특징 인덱스 {index} 가 설계 행렬 {width}열을 벗어납니다")

    def raw_logit(self, payload: dict[str, Any]) -> float:
        # float32 로 한 번 접고 순회한다. 이유는 to_float32 의 설명 참조.
        row = [to_float32(value) for value in self.design_row(payload)]
        total = self.base_margin
        for tree in self.trees:
            node = tree[0]
            while int(node[0]) != self.LEAF:
                node = tree[int(node[2])] if row[int(node[0])] < node[1] else tree[int(node[3])]
            total += node[4]
        return total

    def contributions(self, raw_payload: dict[str, Any]) -> list[tuple[str, float]]:
        """경로 기여도 (Saabas). 노드를 지날 때 예측값이 얼마나 움직였는가.

        정확한 SHAP 이 아니다. 상호작용이 있으면 경로 순서에 따라 배분이 달라지고,
        같은 특징이 여러 트리에서 다르게 쪼개진다. 화면에서 "무엇이 이 숫자를
        올렸나"를 보여주는 용도로는 충분하지만, 이 값을 인과 효과나 개선 조언으로
        옮기면 안 된다 — 그 경고는 로지스틱 계수에도 똑같이 적용된다.
        """
        row = [to_float32(value) for value in self.design_row(raw_payload)]
        names = self.design_names()
        totals = [0.0] * len(names)

        for tree in self.trees:
            node = tree[0]
            while int(node[0]) != self.LEAF:
                index = int(node[0])
                child = tree[int(node[2])] if row[index] < node[1] else tree[int(node[3])]
                totals[index] += child[4] - node[4]
                node = child

        pairs = [(name, value) for name, value in zip(names, totals, strict=True) if abs(value) > 1e-9]
        return sorted(pairs, key=lambda item: abs(item[1]), reverse=True)


class SeedEnsembleRiskModel(BaseRiskModel):
    """시드 앙상블 여럿을 다시 평균하는 모델 (XGBoost 3시드 + CatBoost 3시드).

    합치는 순서가 계약이다. **멤버 안에서는 확률을 평균하고 로짓을 평균하지 않는다.**
    로짓 평균은 기하평균이라 값이 달라지고, 학습 쪽(`modeling/ensemble.py`)이 확률
    평균으로 골라 놨기 때문에 여기서 바꾸면 실험에서 잰 수치가 서빙에서 안 나온다.

        시드 평균(확률) -> 멤버 보정 -> 멤버 평균 -> 앙상블 보정

    트리 표현이 둘이다. XGBoost 는 노드마다 분할이 달라 노드 배열을 순회하고,
    CatBoost 는 대칭(oblivious) 트리라 깊이마다 분할이 하나뿐이다. 후자는 순회가
    아니라 **비교 d 번 뒤 색인 한 번**이라 더 빠르고, 번들도 3 배 넘게 작다.
    잎 색인은 LSB 우선 — j 번째 분할이 참이면 ``idx |= 1 << j``.
    """

    kind = "seed_ensemble"

    LEAF = -1

    def __init__(self, bundle: dict[str, Any]) -> None:
        super().__init__(bundle)
        self.members: list[dict[str, Any]] = bundle["members"]
        self.calibration: dict[str, Any] = bundle.get("calibration", {"method": "none", "parameters": {}})
        if bundle.get("combine", "mean") != "mean":
            raise ValueError(f"{self.target}: 아는 결합 규칙은 mean 뿐입니다")

        width = self.design_width()
        for member in self.members:
            for sub in member["seeds"]:
                if member["kind"] == "gradient_boosted_trees":
                    indices = (int(node[0]) for tree in sub["trees"] for node in tree)
                else:
                    indices = (int(split[0]) for tree in sub["trees"] for split in tree["splits"])
                for index in indices:
                    if index != self.LEAF and not 0 <= index < width:
                        raise ValueError(f"{self.target}: 특징 인덱스 {index} 가 설계 행렬 {width}열을 벗어납니다")

    @staticmethod
    def _walk_nodes(trees: list[list[list[float]]], base_margin: float, row: list[float]) -> float:
        total = base_margin
        for tree in trees:
            node = tree[0]
            while int(node[0]) != SeedEnsembleRiskModel.LEAF:
                node = tree[int(node[2])] if row[int(node[0])] < node[1] else tree[int(node[3])]
            total += node[4]
        return total

    @staticmethod
    def _walk_oblivious(trees: list[dict[str, Any]], scale: float, bias: float, row: list[float]) -> float:
        total = 0.0
        for tree in trees:
            index = 0
            for position, (feature, border) in enumerate(tree["splits"]):
                if row[int(feature)] > border:
                    index |= 1 << position
            total += tree["leaves"][index]
        return total * scale + bias

    def _apply_calibration(self, probability: float, calibration: dict[str, Any]) -> float:
        method = calibration.get("method", "none")
        parameters = calibration.get("parameters", {})
        if method == "platt":
            clipped = min(max(probability, 1e-6), 1 - 1e-6)
            logit = math.log(clipped / (1 - clipped))
            return self._sigmoid(parameters["a"] * logit + parameters["b"])
        if method == "isotonic":
            xs, ys = parameters["x"], parameters["y"]
            if probability <= xs[0]:
                return float(ys[0])
            if probability >= xs[-1]:
                return float(ys[-1])
            # 계단함수의 선형 보간. numpy.interp 와 같은 규칙이다.
            low = 0
            high = len(xs) - 1
            while high - low > 1:
                middle = (low + high) // 2
                if xs[middle] <= probability:
                    low = middle
                else:
                    high = middle
            span = xs[high] - xs[low]
            if span <= 0:
                return float(ys[low])
            weight = (probability - xs[low]) / span
            return float(ys[low] + weight * (ys[high] - ys[low]))
        return probability

    def _member_probability(self, member: dict[str, Any], row: list[float]) -> float:
        values = []
        for sub in member["seeds"]:
            if member["kind"] == "gradient_boosted_trees":
                margin = self._walk_nodes(sub["trees"], sub["base_margin"], row)
            else:
                margin = self._walk_oblivious(sub["trees"], sub["scale"], sub["bias"], row)
            values.append(self._sigmoid(margin))
        return self._apply_calibration(sum(values) / len(values), member["calibration"])

    def probability(self, payload: dict[str, Any]) -> float:
        # 두 모델 다 특징을 float32 로 접어 두고 임계값과 비교한다. 서빙도 같이
        # 접어야 경계에 걸린 값이 같은 쪽으로 간다 — `to_float32` 설명 참조.
        row = [to_float32(value) for value in self.design_row(payload)]
        combined = sum(self._member_probability(m, row) for m in self.members) / len(self.members)
        return self._apply_calibration(combined, self.calibration)

    def raw_probability(self, payload: dict[str, Any]) -> float:
        """**앙상블 보정기가 받는 값** — 멤버별 보정까지 끝낸 뒤의 평균.

        여섯 모델의 보정 전 평균이 아니다. 그 정의를 쓰면 `probability` 와의 관계가
        단조가 아니게 된다 — 멤버마다 보정기가 다르므로 보정 전 평균에서 앞서던
        사람이 보정 후 평균에서 뒤로 갈 수 있고, 실제로 `test_calibration_is_monotone`
        이 20 개 번들 전부에서 그걸 잡았다.

        멤버 보정은 **모델 내부**고 앙상블 보정만 '보정 단계'다. 그렇게 갈라야
        단일 모델(raw = 시그모이드, probability = 보정기(raw))과 같은 계약이 된다.
        """
        row = [to_float32(value) for value in self.design_row(payload)]
        return sum(self._member_probability(m, row) for m in self.members) / len(self.members)

    def raw_logit(self, payload: dict[str, Any]) -> float:
        probability = min(max(self.raw_probability(payload), 1e-6), 1 - 1e-6)
        return math.log(probability / (1 - probability))

    def contributions(self, raw_payload: dict[str, Any]) -> list[tuple[str, float]]:
        """경로 기여도. XGBoost 멤버에서만 모은다.

        대칭 트리는 모든 깊이가 같은 분할을 쓰므로 경로 기여를 특징에 배분하는
        의미가 달라진다. 둘을 섞으면 화면에 나가는 숫자의 뜻이 흐려지므로,
        기여도는 노드 배열 멤버만 쓰고 그 사실을 여기 적어 둔다.
        """
        row = [to_float32(value) for value in self.design_row(raw_payload)]
        names = self.design_names()
        totals = [0.0] * len(names)
        walked = 0

        for member in self.members:
            if member["kind"] != "gradient_boosted_trees":
                continue
            for sub in member["seeds"]:
                walked += 1
                for tree in sub["trees"]:
                    node = tree[0]
                    while int(node[0]) != self.LEAF:
                        index = int(node[0])
                        child = tree[int(node[2])] if row[index] < node[1] else tree[int(node[3])]
                        totals[index] += child[4] - node[4]
                        node = child
        if walked:
            totals = [value / walked for value in totals]

        pairs = [(name, value) for name, value in zip(names, totals, strict=True) if abs(value) > 1e-9]
        return sorted(pairs, key=lambda item: abs(item[1]), reverse=True)


#: 번들의 ``model`` 필드 -> 클래스. 새 모델 종류는 여기에만 추가한다.
MODEL_KINDS: dict[str, type[BaseRiskModel]] = {
    RiskModel.kind: RiskModel,
    TreeRiskModel.kind: TreeRiskModel,
    SeedEnsembleRiskModel.kind: SeedEnsembleRiskModel,
}


def load_bundle(bundle: dict[str, Any]) -> BaseRiskModel:
    kind = bundle.get("model", RiskModel.kind)
    if kind not in MODEL_KINDS:
        raise ValueError(f"알 수 없는 모델 종류입니다: {kind}. 아는 것: {sorted(MODEL_KINDS)}")
    return MODEL_KINDS[kind](bundle)


class RiskModelRegistry:
    """Loads the exported targets, and reloads them when the files change.

    Without the reload, re-running ``export_model.py`` changes nothing until the
    container restarts — the API keeps serving the model it read at import time.
    That failure is invisible: predictions still come back, just from the old
    coefficients. A stat() per request is cheap enough to remove the trap.
    """

    def __init__(self, directory: Path | None = None) -> None:
        self.directory = self._resolve(directory)
        self.models: dict[str, BaseRiskModel] = {}
        self._stamps: dict[str, float] = {}
        self._load()

    def _load(self) -> None:
        if self.directory is None:
            return
        for path in sorted(self.directory.glob("risk_*.json")):
            bundle = json.loads(path.read_text(encoding="utf-8"))
            model = load_bundle(bundle)
            # basic tier 는 target 그대로, 정밀형은 "<target>_lab" 으로 들어간다.
            # 기존 호출부의 get("dm") 이 계속 일반형을 가리키게 하려는 것이다.
            self.models[model.model_id] = model
            self._stamps[path.name] = path.stat().st_mtime

    def refresh(self) -> bool:
        """Reload if any bundle's mtime moved. Returns True when it did."""
        if self.directory is None or not self.directory.is_dir():
            return False
        current = {p.name: p.stat().st_mtime for p in self.directory.glob("risk_*.json")}
        if current == self._stamps:
            return False
        self.models = {}
        self._stamps = {}
        self._load()
        return True

    @staticmethod
    def _resolve(directory: Path | None) -> Path | None:
        """An explicit directory is honoured even when it does not exist.

        Falling back to another location when a configured path is wrong would
        serve a model nobody asked for, and the mistake would surface as slightly
        odd predictions rather than as an error.
        """
        if directory is not None:
            return directory if directory.is_dir() else None
        for candidate in (DEFAULT_MODEL_DIR, REPO_MODEL_DIR):
            if candidate.is_dir():
                return candidate
        return None

    @property
    def available(self) -> bool:
        return bool(self.models)

    def get(self, target: str, tier: str = "basic") -> BaseRiskModel | None:
        """정밀형을 찾되 없으면 일반형으로 내려간다.

        사용자가 검사값을 냈는데 그 질환의 정밀형 번들이 아직 없을 수 있다.
        그때 None 을 돌려주면 카드가 통째로 사라진다. 내려가서 일반형이라도
        보여주는 편이 낫고, 응답의 ``tier`` 가 무엇을 썼는지 알려 준다.
        """
        if tier != "basic":
            found = self.models.get(f"{target}_{tier}")
            if found is not None:
                return found
        return self.models.get(target)

    def targets(self) -> list[str]:
        """적재된 질환 키. tier 접미사를 뗀 고유 목록."""
        return sorted({model.target for model in self.models.values()})


registry = RiskModelRegistry()
