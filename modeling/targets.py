"""질환별 타깃 정의 — 라벨, 라벨 누출 차단 집합, 임계값 출처.

이 파일이 있는 이유는 하나다. **라벨 누출 차단 집합이 질환마다 다르다.**
당뇨는 혈당·HbA1c 를, 고혈압은 혈압을, 이상지질혈증은 지질 4종을 막아야 하는데,
그 대응을 학습 스크립트마다 따로 적으면 언젠가 하나가 어긋난다. 어긋난 순간
AUROC 는 0.99 로 뛰고 모델은 쓸모가 0 이 된다 — 그리고 그 사고는 성능 지표를
보는 것만으로는 절대 잡히지 않는다. 오히려 성능이 좋아 보인다.

그래서 규칙은 이렇다.

* ``labels.py`` 의 라벨 정의에 등장하는 컬럼은 전부 ``blocked`` 에 들어간다
* 그 컬럼에서 계산으로 복원되는 값도 들어간다 (Friedewald LDL 은 중성지방을
  담고 있으므로 대사증후군 타깃에서 ``ldl`` 이 막힌다)
* 파생 특징은 재료가 하나라도 막히면 같이 막힌다 (``tg_hdl_ratio``)

``tier`` 는 두 가지다. ``basic`` 은 검진 결과지 없이 답할 수 있는 것만,
``lab`` 은 거기에 결과지 수치를 더한다. 두 tier 를 한 모델에 섞지 않는 이유는
결측 패턴 자체가 "이 사람이 검진을 받았는가"라는 신호가 되기 때문이다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# 입력 블록
# ---------------------------------------------------------------------------

# 검진 결과지 없이 답할 수 있는 것. 혈압과 허리둘레는 검사가 아니라 측정이라
# 가정용 혈압계와 줄자로 채울 수 있어서 여기 둔다.
BASIC_FEATURES: tuple[str, ...] = (
    "age",
    "sex",
    "bmi",
    "self_rated_health",
    "height_cm",
    "waist_cm",
    "smoking_status",
    "difficulty_walking",
    "alcohol_days_per_year",
    "moderate_min_per_week",
    "vigorous_min_per_week",
    "sedentary_min_per_day",
    "sleep_hours",
    "education_level",
    "sbp",
    "dbp",
)

# 국가건강검진 결과지에 인쇄되는 수치. 전부 선택 입력이다.
LAB_FEATURES: tuple[str, ...] = (
    "fasting_glucose",
    "hba1c",
    "total_chol",
    "hdl",
    "ldl",
    "triglyceride",
    "ast",
    "alt",
    "ggt",
    "uric_acid",
    "creatinine",
    "egfr",
    "hemoglobin",
    "albumin",
    "urine_acr",
)

# 파생 비율 -> 재료. 재료가 하나라도 blocked 면 파생도 만들지 않는다.
#
# 무엇을 넣을지 고르는 기준이 하나 더 있다. **서빙 모델 20 개 중 19 개가 GBDT 다.**
# 트리는 축에 평행한 분할만 하므로 기존 특징의 **단조 변환은 정보를 0 만큼 더한다** —
# 트리가 이미 그 순서를 알고 있기 때문이다. 그래서 문헌에 자주 나오지만 여기 없는
# 지수가 셋 있다.
#
#   BRI  = 364.2 − 365.5·√(1 − ((WC/2π)/(0.5·h))²)  → waist_height_ratio 의 단조 증가 함수
#   RFM  = 64 − 20·(h/WC) + 12·여성                  → waist_height_ratio + sex 로 복원된다
#   AIP  = log10(TG/HDL)                             → tg_hdl_ratio 의 단조 증가 함수
#
# 세 지수의 문헌 근거는 튼튼하지만 그건 **선형 모델**에서 얻은 것이다. 여기 남긴 것은
# 전부 트리가 스스로 만들기 어려운 형태다 — 곱(LAP·TyG), 선형결합(FLI·remnant),
# 여러 변수를 한 번에 섞는 비율(VAI·METS-IR).
DERIVED: dict[str, tuple[str, ...]] = {
    # 인슐린 저항성 대리 지표. 두 값을 따로 넣는 것보다 낫다는 보고가 많다.
    "tg_hdl_ratio": ("triglyceride", "hdl"),
    # 총콜레스테롤에서 HDL 을 뺀 값. LDL 과 달리 공복이 아니어도 계산된다.
    "non_hdl": ("total_chol", "hdl"),
    # 알코올성/비알코올성 간질환을 가르는 고전적 비율.
    "ast_alt_ratio": ("ast", "alt"),
    # BMI 가 못 잡는 복부 비만. 같은 BMI 에서도 위험이 갈린다.
    "waist_height_ratio": ("waist_cm", "height_cm"),
    # --------------------------------------------------------------- 신규
    # ln(TG·FPG/2). HOMA-IR 보다 제2형 당뇨 예측이 낫다는 보고가 반복된다.
    # 한국인 절단값 남 8.82 / 여 8.73 (KNHANES n=39,410).
    "tyg": ("triglyceride", "fasting_glucose"),
    # Bedogni 2006. TG·BMI·γ-GTP·허리의 로지스틱 결합이고 CAP 과 상관이 확인돼 있다.
    # 라벨이 CAP 실측이라 이 지수를 특징으로 써도 순환하지 않는다.
    "fli": ("triglyceride", "bmi", "ggt", "waist_cm"),
    # Kahn 2005. 허리에서 성별 기준선을 뺀 값에 TG 를 곱한다.
    "lap": ("triglyceride", "waist_cm", "sex"),
    # Amato 2010. 내장지방 '기능'을 재는 성별 분리 식.
    "vai": ("triglyceride", "hdl", "bmi", "waist_cm", "sex"),
    # (TG/HDL) × 허리높이비. 두 파생의 곱이라 트리가 스스로 못 만든다.
    "cmi": ("triglyceride", "hdl", "waist_cm", "height_cm"),
    # Bello-Chavolla 2018. 공복혈당·TG·BMI·HDL 을 한 번에 섞는다.
    "mets_ir": ("fasting_glucose", "triglyceride", "bmi", "hdl"),
    # Krakauer 2012. BRI·RFM 과 달리 BMI 가 따로 들어가 허리높이비로 복원되지 않는다.
    "absi": ("waist_cm", "bmi", "height_cm"),
    # 잔여 콜레스테롤. TG 풍부 지단백의 죽상 유발분을 직접 센다.
    "remnant_chol": ("total_chol", "hdl", "ldl"),
    "tc_hdl_ratio": ("total_chol", "hdl"),  # Castelli I
    "ldl_hdl_ratio": ("ldl", "hdl"),  # Castelli II
    # 신기능으로 표준화한 요산 생산량. 근거가 상충하는 지표라 검정으로 정한다.
    "uric_creatinine_ratio": ("uric_acid", "creatinine"),
    # 맥압과 평균동맥압. 고혈압·대사증후군에서는 혈압이 라벨이라 자동으로 막힌다.
    "pulse_pressure": ("sbp", "dbp"),
    "mean_arterial_pressure": ("sbp", "dbp"),
}

# 실제로 학습에 들어가는 임상 지수. **기본은 비어 있다.**
#
# 26번 문서의 실측이 이유다 — 35 칸 중 유의한 개선이 다섯이었고 나머지 서른 칸은
# 0 언저리거나 음수였다. 원재료가 이미 특징이면 GBDT 가 그 조합을 스스로 쓰므로
# 지수를 얹으면 중복 특징이 분할만 흩뜨린다. 그래서 `DERIVED` 에 정의는 남기되
# 켜는 것은 근거가 붙은 자리에서 하나씩 한다.
#
#     from targets import enable_indices
#     enable_indices("pulse_pressure")          # 빈혈 일반형 +0.0055
#     enable_indices(*NEW_INDICES)              # 실험 하네스가 쓰는 방식
ENABLED_INDICES: set[str] = set()


def enable_indices(*names: str) -> None:
    ENABLED_INDICES.update(names)


# 정의만 있고 기본은 꺼져 있는 지수 전체. 실험에서 base 를 만들 때 통째로 빼는 데 쓴다.
NEW_INDICES: tuple[str, ...] = (
    "tyg",
    "fli",
    "lap",
    "vai",
    "cmi",
    "mets_ir",
    "absi",
    "remnant_chol",
    "tc_hdl_ratio",
    "ldl_hdl_ratio",
    "uric_creatinine_ratio",
    "pulse_pressure",
    "mean_arterial_pressure",
)

CATEGORICAL: tuple[str, ...] = ("sex", "smoking_status")

# ---------------------------------------------------------------------------
# 공통 차단 집합
# ---------------------------------------------------------------------------

LIPID_PANEL = ("total_chol", "hdl", "ldl", "triglyceride")
GLUCOSE_PANEL = ("fasting_glucose", "hba1c")
BLOOD_PRESSURE = ("sbp", "dbp")


@dataclass(frozen=True)
class Criterion:
    """진단 기준 한 줄. 기계가 읽고 서빙에서 직접 판정할 수 있는 형태.

    이게 필요한 이유
    ----------------
    라벨을 만드는 검사값은 그 질환의 ML 입력에서 차단된다. 정당한 조치지만
    화면에서는 **사고**가 된다 — 사용자가 혈색소 10.6(WHO 여성 기준 12 미만)을
    입력해도 빈혈 모델은 그 값을 볼 수 없으므로 초록색 "낮음"이 뜬다. 답을
    확정하는 값을 넣었는데 화면이 안심시키는 것이다.

    규칙 엔진(`chronic_disease_engine/`)이 그 자리를 메우지만 고혈압·당뇨·
    이상지질혈증·비만 넷만 다룬다. 나머지 여섯(대사증후군·신기능·지방간·빈혈·
    지질 하위유형)은 대응 영역이 없다. 그래서 임계값을 여기에 적어 두고 번들로
    내보내, 검사값이 들어온 순간 ML 확률 대신 **기준 판정**을 정본으로 올린다.

    임계값의 단일 진실 원천은 `data/labels.py` 의 ``Thresholds`` 다. 여기 값은
    거기서 그대로 옮겨 적고, 어긋나면 `app/tests` 의 대조 검사가 잡는다.
    """

    field: str  # 사용자 입력 이름 (DTO 필드명과 같아야 한다)
    label: str  # 화면에 쓰는 이름
    unit: str
    op: str  # ">=" | "<" | ">"
    value: float | None = None
    # 성별로 기준이 갈리는 항목. 값이 있으면 value 대신 이쪽을 쓴다.
    by_sex: dict[str, float] | None = None


@dataclass(frozen=True)
class Target:
    """한 질환의 학습 계약."""

    key: str
    name: str  # 화면에 쓰는 이름
    label: str  # labels.py 가 만든 컬럼
    definition: str  # 라벨 정의 원문. 모델 카드에 그대로 실린다
    threshold_source: str  # 임계값을 가져온 학회·문서
    blocked: tuple[str, ...]  # 라벨 누출. 절대 특징이 될 수 없다
    undiagnosed_label: str | None = None  # 미진단 선별 변형
    tiers: tuple[str, ...] = ("basic", "lab")
    holdout_cycle: str = "2021_2023"
    note: str = ""
    # 화면에 카드로 올릴 후보인지. False 면 조사·검증 목적으로만 학습한다.
    serve: bool = True
    # 검사값이 들어오면 ML 대신 이걸로 판정한다. 하나라도 충족하면 양성.
    criteria: tuple[Criterion, ...] = ()
    extra: dict[str, str] = field(default_factory=dict)

    def features(self, tier: str) -> list[str]:
        """이 타깃·tier 에서 쓸 수 있는 입력. blocked 를 뺀 뒤 파생을 붙인다."""
        blocked = set(self.blocked)
        columns = [c for c in BASIC_FEATURES if c not in blocked]
        if tier == "lab":
            columns += [c for c in LAB_FEATURES if c not in blocked]
        available = set(columns)
        for name, parts in DERIVED.items():
            # 신규 임상 지수는 명시적으로 켠 것만 들어간다. 기존 파생 넷은 그대로.
            if name in NEW_INDICES and name not in ENABLED_INDICES:
                continue
            if all(part in available for part in parts):
                columns.append(name)
        return columns


TARGETS: dict[str, Target] = {
    # ------------------------------------------------------------------ 당뇨
    "dm": Target(
        key="dm",
        name="당뇨",
        label="label_dm_prevalent",
        definition="공복혈당 ≥126 mg/dL 또는 HbA1c ≥6.5% 또는 의사진단 또는 투약",
        threshold_source="대한당뇨병학회 진료지침 (ADA 기준과 동일)",
        blocked=(*GLUCOSE_PANEL, "dx_diabetes", "med_diabetes", "dx_prediabetes_told"),
        undiagnosed_label="label_dm_undiagnosed",
        note="지질·간효소·요산은 라벨 정의에 없다. 정밀형에서 특징으로 쓴다.",
        criteria=(
            Criterion("fasting_glucose", "공복혈당", "mg/dL", ">=", 126.0),
            Criterion("hba1c", "당화혈색소", "%", ">=", 6.5),
        ),
    ),
    # ---------------------------------------------------------------- 고혈압
    "htn": Target(
        key="htn",
        name="고혈압",
        label="label_htn_prevalent",
        definition="수축기 ≥140 mmHg 또는 이완기 ≥90 mmHg 또는 의사진단 또는 투약",
        threshold_source="대한고혈압학회 진료지침",
        blocked=(*BLOOD_PRESSURE, "dx_hypertension", "med_hypertension"),
        undiagnosed_label="label_htn_undiagnosed",
        note="혈압이 라벨이라 입력이 될 수 없다. 카드 문구는 '혈압을 재면 기준을 넘을 가능성'.",
        criteria=(
            Criterion("sbp", "수축기 혈압", "mmHg", ">=", 140.0),
            Criterion("dbp", "이완기 혈압", "mmHg", ">=", 90.0),
        ),
    ),
    # -------------------------------------------------------- 이상지질혈증
    "dlp": Target(
        key="dlp",
        name="이상지질혈증",
        label="label_dlp_prevalent",
        definition="TC ≥240 또는 LDL ≥160 또는 TG ≥200 또는 HDL <40 mg/dL 또는 의사진단 또는 지질강하제",
        threshold_source="한국지질·동맥경화학회 이상지질혈증 진료지침 제5판(2022)",
        blocked=(*LIPID_PANEL, "dx_high_cholesterol", "med_lipid"),
        undiagnosed_label="label_dlp_undiagnosed",
        note="유병률 49%. 고혈압과 같은 구조라 '위험합니다' 화면으로 쓰면 안 되고 백분위로만 보여준다.",
        criteria=(
            Criterion("total_chol", "총콜레스테롤", "mg/dL", ">=", 240.0),
            Criterion("ldl", "LDL 콜레스테롤", "mg/dL", ">=", 160.0),
            Criterion("triglyceride", "중성지방", "mg/dL", ">=", 200.0),
            Criterion("hdl", "HDL 콜레스테롤", "mg/dL", "<", 40.0),
        ),
    ),
    "hyperchol": Target(
        key="hyperchol",
        name="고LDL콜레스테롤혈증",
        label="label_hyperchol",
        definition="총콜레스테롤 ≥240 mg/dL 또는 LDL ≥160 mg/dL (지질강하제 복용자 제외)",
        threshold_source="한국지질·동맥경화학회 제5판(2022)",
        blocked=(*LIPID_PANEL, "dx_high_cholesterol", "med_lipid"),
        note="하위유형은 측정값만으로 정의한다. 치료된 값으로는 어느 분획이 높았는지 알 수 없다.",
        criteria=(
            Criterion("total_chol", "총콜레스테롤", "mg/dL", ">=", 240.0),
            Criterion("ldl", "LDL 콜레스테롤", "mg/dL", ">=", 160.0),
        ),
    ),
    "hypertg": Target(
        key="hypertg",
        name="고중성지방혈증",
        label="label_hypertg",
        definition="중성지방 ≥200 mg/dL (지질강하제 복용자 제외)",
        threshold_source="한국지질·동맥경화학회 제5판(2022)",
        blocked=(*LIPID_PANEL, "dx_high_cholesterol", "med_lipid"),
        note="공복 채혈 하위표본만 중성지방을 재서 라벨 수가 다른 타깃의 3분의 1이다.",
        criteria=(Criterion("triglyceride", "중성지방", "mg/dL", ">=", 200.0),),
    ),
    "low_hdl": Target(
        key="low_hdl",
        name="낮은 HDL 콜레스테롤",
        label="label_low_hdl",
        definition="HDL <40 mg/dL, 남녀 공통 (지질강하제 복용자 제외)",
        threshold_source="한국지질·동맥경화학회 제5판(2022)",
        blocked=(*LIPID_PANEL, "dx_high_cholesterol", "med_lipid"),
        note="대사증후군은 같은 항목을 남 40 / 여 50 으로 읽는다. 카드마다 학회명을 병기해야 한다.",
        criteria=(Criterion("hdl", "HDL 콜레스테롤", "mg/dL", "<", 40.0),),
    ),
    # ---------------------------------------------------------- 대사증후군
    "mets": Target(
        key="mets",
        name="대사증후군",
        label="label_mets",
        definition="허리(남90/여85)·TG≥150·HDL<40(남)/50(여)·혈압≥130/85·공복혈당≥100 중 3개 이상 (복약 포함)",
        threshold_source="NCEP ATP III 개정(2005), 허리둘레만 대한비만학회 한국 기준",
        # 5요소 전부와 그 복약, 그리고 재료에서 복원되는 값까지 막는다.
        # Friedewald LDL = TC − HDL − TG/5 이므로 ldl 과 total_chol 이 중성지방을
        # 담고 있다. 남기면 대사증후군 라벨이 특징에서 그대로 되살아난다.
        blocked=(
            "waist_cm",
            *LIPID_PANEL,
            *BLOOD_PRESSURE,
            *GLUCOSE_PANEL,
            "med_lipid",
            "med_hypertension",
            "med_diabetes",
            "dx_diabetes",
            "dx_hypertension",
            "dx_high_cholesterol",
        ),
        note="허리둘레가 진단 요소라 입력에서 빠진다. BMI 로 대신 잡는 셈이라 성능 상한이 낮다.",
    ),
    # -------------------------------------------------------------- 신기능
    "ckd": Target(
        key="ckd",
        name="신기능 확인 필요",
        label="label_ckd",
        definition="eGFR <60 mL/min/1.73m² (CKD-EPI 2021) 또는 요알부민/크레아티닌비 ≥30 mg/g",
        threshold_source="KDIGO 2012 CKD 진료지침",
        blocked=("creatinine", "egfr", "urine_acr"),
        note="KDIGO 의 3개월 지속 요건을 단면 1회 측정으로 채울 수 없다. 화면에서 'CKD'라 부르지 않는다.",
        criteria=(
            Criterion("egfr", "사구체여과율", "mL/min/1.73m²", "<", 60.0),
            Criterion("urine_acr", "요알부민/크레아티닌비", "mg/g", ">=", 30.0),
        ),
    ),
    "egfr_low": Target(
        key="egfr_low",
        name="사구체여과율 저하",
        label="label_egfr_low",
        definition="eGFR <60 mL/min/1.73m² (CKD-EPI 2021)",
        threshold_source="KDIGO 2012",
        blocked=("creatinine", "egfr", "urine_acr"),
        serve=False,
        note="ckd 의 부분집합이라 카드는 하나만 올린다. 두 라벨의 차이를 보려고 같이 학습한다.",
        criteria=(Criterion("egfr", "사구체여과율", "mL/min/1.73m²", "<", 60.0),),
    ),
    # -------------------------------------------------------------- 지방간
    "fatty_liver": Target(
        key="fatty_liver",
        name="지방간",
        label="label_fatty_liver",
        definition="간 탄성초음파 감쇠계수(CAP) ≥274 dB/m",
        threshold_source="Karlas 2017 메타분석 S1 이상 컷오프",
        # CAP 은 초음파 실측이라 간효소가 라벨 안에 없다. AST·ALT·γ-GTP 를
        # 특징으로 쓸 수 있고, 그게 이 타깃을 정밀형으로 세우는 이유다.
        blocked=("dx_liver", "cap_db_m"),
        holdout_cycle="2021_2023",
        note="CAP 은 2017-2018·2021-2023 두 주기에만 있다. 학습 표본이 다른 타깃의 10분의 1.",
    ),
    "liver_enzyme_high": Target(
        key="liver_enzyme_high",
        name="간효소 상승",
        label="label_liver_enzyme_high",
        definition="ALT >34 IU/L(남) / >25 IU/L(여)",
        threshold_source="Prati 2002 정상 상한. 지방간 진단 기준이 아니다",
        blocked=("ast", "alt", "ggt", "dx_liver"),
        serve=False,
        note="CAP 이 없는 6개 주기를 덮는 대리 라벨. 지방간 모델의 표본 한계를 재는 용도.",
        criteria=(Criterion("alt", "ALT(SGPT)", "IU/L", ">", None, {"M": 34.0, "F": 25.0}),),
    ),
    # ---------------------------------------------------------------- 빈혈
    "anemia": Target(
        key="anemia",
        name="빈혈",
        label="label_anemia",
        definition="혈색소 <13 g/dL(남) / <12 g/dL(여). 임신 중인 응답자는 제외",
        threshold_source="WHO Haemoglobin concentrations for the diagnosis of anaemia (2011)",
        blocked=("hemoglobin",),
        note="임신 기준(11 g/dL)이 달라 임신부는 라벨에서 뺐다.",
        criteria=(Criterion("hemoglobin", "혈색소", "g/dL", "<", None, {"M": 13.0, "F": 12.0}),),
    ),
}


def serving_targets() -> list[Target]:
    return [t for t in TARGETS.values() if t.serve]


def leakage_report() -> list[dict[str, object]]:
    """타깃마다 무엇이 막혔고 무엇이 남았는지. CI 에서 회귀로 쓴다."""
    rows = []
    for target in TARGETS.values():
        for tier in target.tiers:
            columns = target.features(tier)
            rows.append(
                {
                    "target": target.key,
                    "tier": tier,
                    "n_features": len(columns),
                    "blocked": sorted(target.blocked),
                    "features": columns,
                }
            )
    return rows
