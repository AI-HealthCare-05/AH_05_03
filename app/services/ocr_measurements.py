"""인식한 표를 **예측 입력 수치로** 옮긴다. 옮겨도 되는 것만 옮긴다.

## 왜 필요한가

`dev_ocr._PROMPT` 은 `[검사항목명, 결과값, 단위, 판정및참고치]` 4열 표를 공들여 뽑아내는데,
그 표를 읽는 코드가 저장소에 없었다. 화면은 `text` 만 받아 자유 메모로 저장하고 끝냈고
(`DataManagementPage.saveOcrResult`), 사용자는 검진표를 올린 뒤에도 예측 화면에서 수치를
손으로 다시 쳤다.

그 한 칸이 예측 정밀도의 최대 지렛대다. `modeling/artifacts/tier_comparison.json` 실측 —
검사값이 채워지면 정밀형 번들로 자동 전환되고 10 질환 전부 유의하게 오른다
(빈혈 +0.167, 고LDL +0.101, 중앙값 +0.045 AUROC).

## 왜 이름을 믿지 않는가

**숫자는 안 틀리고 이름이 틀린다.** `config.OPENAI_IMAGE_DETAIL` 주석에 실측이 있다 —
값 6개는 모든 모델이 매번 맞혔고 갈린 것은 검사명과 참고치였다. 기록된 오독은 둘이다.

    요소질소(BUN 12.0)  →  요산      : 요산 6.1 인 사람이 12.0 으로 잡혀 중증 고요산혈증
    크레아티닌          →  크레아틴  : 아예 다른 검사

그래서 이 모듈은 **넓게 잡는 대신 좁게 잡는다.**

1. **사전에 정확히 있는 표기만 받는다.** 유사도 매칭을 쓰지 않는다 — `크레아틴` 은
   사전에 없으므로 그냥 안 잡히고, 값은 버려진다. 잘못 배정되는 것보다 낫다.
2. **잡힌 뒤에도 세 관문을 통과해야 수치가 된다.** 단위·인쇄된 참고치·DTO 범위.
   `요산` 으로 읽힌 BUN 은 인쇄된 참고치가 `8~20` 이라 요산의 기대 참고치
   `2.0~7.5` 와 겹치지 않아 여기서 걸린다.
3. **같은 항목이 두 행에 나오면 둘 다 안 받는다.** 실제로 `요산` 행이 둘 나온 적이 있다.

통과하지 못한 행은 버리지 않고 `review` 로 넘겨 사용자가 눈으로 확인하게 한다.
**`values` 에 들어간 것만 예측에 쓰인다.**

## 관문의 세기가 서로 다르다 — 참고치에 기대지 마라

2026-08-28 같은 이미지를 두 번 태운 실측이다.

    1회차   크레아틴 0.88  mg/dL  정상: 0.1~1.5   ← 이름 오독
    2회차   크레아티닌 0.88 (단위 없음) 정상: 0.1~5  ← 이름은 맞고 단위·참고치가 사라짐

**모델은 참고치를 자주 지어내거나 빠뜨리고, 단위 열을 통째로 비우기도 한다.**
그래서 참고치 관문은 *있으면 쓰는* 보조 수단이지 방어선이 아니다. 실제로 버티는 것은
① 좁은 사전 ② DTO 범위 ③ 중복 검사 셋이다.

단위가 비어 있으면 국내 관용 단위(mg/dL 등)로 보고 환산하지 않는다. 위험해 보이지만
SI 단위 값이 단위 없이 들어와도 **②가 잡는다** — 공복혈당 5.5(mmol/L)는 `ge=20` 에,
혈색소 140(g/L)은 `le=25` 에, 크레아티닌 80(µmol/L)은 `le=20` 에 걸린다.

## 경계

여기서 하는 일은 "표 → 수치" 뿐이다. 어느 모델을 부르는지, 어떤 tier 로 채점하는지는
`RiskPredictionRequest.to_features` 가 이미 정하고 있으므로 건드리지 않는다.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass
from dataclasses import field as dataclass_field
from typing import Any

import annotated_types

from app.dtos.assessment_summary import AssessmentSummaryRequest

# --------------------------------------------------------------------------
# 검사명 사전
# --------------------------------------------------------------------------
#
# 국가건강검진 결과지·병원 검사결과서에 **실제로 인쇄되는 표기**만 넣는다.
# 여기 없는 표기는 안 잡히고, 안 잡히면 그 행은 수치가 되지 않는다 — 그게 안전한 쪽이다.
# 표기를 추가할 때는 그 문서를 직접 보고 넣어라. "그럴 것 같은" 이름을 넣으면
# 오독이 사전을 통과하게 된다.
_ALIASES: dict[str, tuple[str, ...]] = {
    # --- 신체계측 ---------------------------------------------------
    "height_cm": ("신장", "키", "height"),
    "weight_kg": ("체중", "몸무게", "weight"),
    "waist_cm": ("허리둘레", "복부둘레", "waist", "waistcircumference"),
    # --- 혈압 -------------------------------------------------------
    "sbp": ("수축기혈압", "최고혈압", "수축기", "systolic", "systolicbp", "sbp"),
    "dbp": ("이완기혈압", "최저혈압", "이완기", "diastolic", "diastolicbp", "dbp"),
    # --- 혈당 -------------------------------------------------------
    "fasting_glucose": (
        "공복혈당",
        "식전혈당",
        "공복시혈당",
        "공복혈당fbs",
        "혈당공복",
        "fbs",
        "fpg",
        "glucose",
        "glucosefasting",
    ),
    "hba1c": ("당화혈색소", "당화혈색소hba1c", "헤모글로빈a1c", "hba1c", "a1c"),
    "ogtt_2h": ("경구당부하검사", "당부하2시간", "ogtt", "ogtt2h"),
    # --- 지질 -------------------------------------------------------
    # **`tc` 는 일부러 뺐다.** 한 글자 차이인 `tg`(중성지방)가 같은 사전에 있어서,
    # OCR 이 한 글자만 틀려도 값이 통째로 다른 칸에 앉는다. 그런데 총콜레스테롤 188 도
    # 중성지방 188 도 둘 다 DTO 범위 안이라 관문이 못 잡는다 — 사전에서 막는 수밖에 없다.
    # 검진표는 `총콜레스테롤`·`Total Cholesterol`·`T-CHOL` 로 찍지 맨 `TC` 는 드물다.
    "total_chol": ("총콜레스테롤", "총콜레스테롤수치", "totalcholesterol", "tchol", "tcho"),
    "hdl": ("hdl콜레스테롤", "hdl콜레스테롤수치", "고밀도지단백", "고밀도콜레스테롤", "hdl", "hdlc", "hdlcholesterol"),
    "ldl": ("ldl콜레스테롤", "ldl콜레스테롤수치", "저밀도지단백", "저밀도콜레스테롤", "ldl", "ldlc", "ldlcholesterol"),
    # `트리글리세리드` 는 오타가 아니라 실제로 쓰이는 표기이고, 2026-09-03 채점
    # 세트(`scripts/score_ocr.py`)에서 OCR 이 이 꼴로 읽어 한 칸을 통째로 놓쳤다.
    "triglyceride": ("중성지방", "트리글리세라이드", "트리글리세리드", "tg", "triglyceride", "triglycerides"),
    # --- 간기능 -----------------------------------------------------
    #
    # `sgot`·`sgpt` 는 옛 이름이라 아직 그대로 찍는 기관이 있다. 괄호 안에 들어가는
    # 일이 많은데(`AST(SGOT)`) `_candidates` 가 괄호를 갈라 주므로 둘 다 잡힌다.
    "ast": ("ast", "sgot", "astsgot", "아스파르테이트아미노전이효소"),
    "alt": ("alt", "sgpt", "altsgpt", "알라닌아미노전이효소"),
    "ggt": ("감마지티피", "감마gtp", "ggt", "ggtp", "rgtp", "ygtp", "gammagtp"),
    # --- 신장 -------------------------------------------------------
    "creatinine": ("크레아티닌", "혈청크레아티닌", "creatinine", "cr"),
    "urine_acr": ("요알부민크레아티닌비", "알부민크레아티닌비", "acr", "uacr", "microalbumincreatinineratio"),
    # --- 혈액·기타 --------------------------------------------------
    "hemoglobin": ("혈색소", "헤모글로빈", "hb", "hgb", "hemoglobin"),
    # **`ua` 도 일부러 뺐다.** 이 저장소에서 가장 비싸게 틀린 칸이 요산이다
    # (`요소질소` BUN 12.0 → `요산`, 정상인 사람이 중증 고요산혈증). `UN`(urea nitrogen)
    # 에서 한 글자만 틀리면 `UA` 가 되므로, 그 짧은 표기를 열어 두는 것은 같은 사고의
    # 문을 하나 더 내는 일이다. 검진표는 `요산` 또는 `Uric Acid` 로 찍는다.
    "uric_acid": ("요산", "uricacid"),
    "albumin": ("알부민", "혈청알부민", "albumin", "alb"),
}

#: 검진표에 인쇄되지만 **모델 입력이 아닌** 항목. 못 읽은 것과 구분해 주기 위해서다.
#:
#: `요소질소` 가 여기 있는 이유는 문서화 이상이다 — 이 항목이 `요산` 으로 잘못 읽히는
#: 것이 기록된 오독이라, "이 문서에 BUN 행이 있었다" 는 사실 자체가 요산 행을 의심할
#: 근거가 된다. 지금은 분류에만 쓰고, 판정은 참고치·중복 관문이 한다.
_KNOWN_BUT_UNUSED: dict[str, tuple[str, ...]] = {
    "요소질소(BUN)": ("요소질소", "혈중요소질소", "bun", "ureanitrogen"),
    "총단백": ("총단백", "totalprotein", "tp"),
    "총빌리루빈": ("총빌리루빈", "빌리루빈", "totalbilirubin", "tbil"),
    "요단백": ("요단백", "단백뇨", "urineprotein"),
    "적혈구": ("적혈구", "rbc"),
    "백혈구": ("백혈구", "wbc"),
    "혈소판": ("혈소판", "plt", "platelet"),
    "헤마토크릿": ("헤마토크릿", "hct", "hematocrit"),
    "estimated GFR": ("사구체여과율", "추정사구체여과율", "egfr", "gfr"),
}

#: **실제로 관측한** 오독만 넣는다. 추측으로 채우면 그 순간 오독이 사전을 통과한다.
#:
#: 여기 걸린 행은 통과해도 `values` 에 안 들어가고 **검토로만 간다.** 값을 잃지도,
#: 말없이 채우지도 않는 자리다 — 사람이 원본을 보면 1초에 가리는 물음이라
#: 코드가 대신 결정할 이유가 없다.
#:
#: `크레아틴`: 2026-08-27·08-28 두 번 관측(`config.OPENAI_IMAGE_DETAIL` 주석, 그리고
#: `sample.jpeg` 실측에서 `크레아티닌 0.88`이 `크레아틴`으로). 크레아틴은 국가건강검진
#: 항목이 아니라 검진표에 이 이름이 인쇄될 일이 없다. 그래도 채택은 안 한다 —
#: 크레아티닌은 신기능 판정의 재료라 틀리면 되돌릴 수 없다.
_KNOWN_MISREADS: dict[str, str] = {
    "크레아틴": "creatinine",
}


# --------------------------------------------------------------------------
# 단위
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class _Unit:
    """이 검사에 기대하는 단위와, 받아 줄 수 있는 다른 단위의 환산 계수.

    환산은 **정확한 상수 곱**일 때만 넣는다. 어림값으로 바꾸면 그 오차가 그대로
    확률에 실리고, 사용자는 자기가 적지도 않은 숫자로 판정받게 된다.
    """

    canonical: str
    #: 정규화된 단위 문자열 → 곱할 계수. `canonical` 자신은 1.0 으로 자동 포함된다.
    conversions: dict[str, float] = dataclass_field(default_factory=dict)


_UNITS: dict[str, _Unit] = {
    "height_cm": _Unit("cm"),
    "weight_kg": _Unit("kg"),
    "waist_cm": _Unit("cm", {"inch": 2.54, "in": 2.54}),
    "sbp": _Unit("mmhg"),
    "dbp": _Unit("mmhg"),
    # mmol/L → mg/dL 은 포도당 분자량으로 정해진 상수다 (×18.0182).
    "fasting_glucose": _Unit("mg/dl", {"mmol/l": 18.0182}),
    "ogtt_2h": _Unit("mg/dl", {"mmol/l": 18.0182}),
    # HbA1c 의 IFCC(mmol/mol) → NGSP(%) 는 곱셈이 아니라 1차식이라 여기서 못 다룬다.
    # 단위가 `mmol/mol` 이면 환산하지 않고 검토로 넘긴다.
    "hba1c": _Unit("%"),
    "total_chol": _Unit("mg/dl", {"mmol/l": 38.67}),
    "hdl": _Unit("mg/dl", {"mmol/l": 38.67}),
    "ldl": _Unit("mg/dl", {"mmol/l": 38.67}),
    "triglyceride": _Unit("mg/dl", {"mmol/l": 88.57}),
    "ast": _Unit("u/l"),
    "alt": _Unit("u/l"),
    "ggt": _Unit("u/l"),
    "creatinine": _Unit("mg/dl", {"umol/l": 1 / 88.4}),
    "urine_acr": _Unit("mg/g", {"mg/mmol": 8.84}),
    "hemoglobin": _Unit("g/dl", {"g/l": 0.1}),
    "uric_acid": _Unit("mg/dl", {"umol/l": 1 / 59.48}),
    "albumin": _Unit("g/dl", {"g/l": 0.1}),
}

#: 단위 표기 흔들림을 하나로 모은다. `IU/L`·`U/L`·`U/l` 은 같은 것이고,
#: `µ`(마이크로 기호)와 `μ`(그리스 뮤)는 눈으로 구분되지 않는데 코드포인트가 다르다.
_UNIT_SYNONYMS = {
    "iu/l": "u/l",
    "ui/l": "u/l",
    "units/l": "u/l",
    "µmol/l": "umol/l",
    "μmol/l": "umol/l",
    "mmhg": "mmhg",
    "mm hg": "mmhg",
    "mgdl": "mg/dl",
    "mg/dL": "mg/dl",
    "gdl": "g/dl",
    "퍼센트": "%",
}


# --------------------------------------------------------------------------
# 기대 참고치 — **값을 채우는 데 쓰지 않는다. 이름을 의심하는 데만 쓴다.**
# --------------------------------------------------------------------------
#
# 문서에 인쇄된 참고치와 여기 값이 **전혀 겹치지 않으면** 검사명을 잘못 읽었다고 본다.
# 넉넉하게 잡는다 — 기관마다 참고치가 다르고, 좁게 잡으면 멀쩡한 행이 검토로 밀린다.
# 잡아내려는 것은 "조금 다름" 이 아니라 `요산(2.0~7.5)` 자리에 `BUN(8~20)` 이 앉는
# 종류의 어긋남이다.
_EXPECTED_REFERENCE: dict[str, tuple[float, float]] = {
    "fasting_glucose": (60.0, 130.0),
    "hba1c": (3.5, 7.0),
    "total_chol": (0.0, 250.0),
    "hdl": (20.0, 100.0),
    "ldl": (0.0, 190.0),
    "triglyceride": (0.0, 250.0),
    "ast": (0.0, 50.0),
    "alt": (0.0, 50.0),
    "ggt": (0.0, 80.0),
    "creatinine": (0.3, 1.8),
    "hemoglobin": (10.0, 18.0),
    "uric_acid": (2.0, 7.5),
    "albumin": (3.0, 5.5),
    "urine_acr": (0.0, 30.0),
    "sbp": (80.0, 145.0),
    "dbp": (50.0, 95.0),
    "ogtt_2h": (0.0, 145.0),
}


# --------------------------------------------------------------------------
# 결과 모양
# --------------------------------------------------------------------------
@dataclass
class Measurement:
    """행 하나를 읽은 결과."""

    field: str
    label: str
    value: float
    unit: str
    #: 원문 4열. 사용자가 화면에서 원본과 대조할 수 있어야 한다.
    source: list[str]
    #: 검토로 넘긴 이유. `None` 이면 통과.
    reason: str | None = None


@dataclass
class ExtractionResult:
    """`values` 만 예측에 쓴다. 나머지는 사람이 본다."""

    values: dict[str, float]
    review: list[Measurement]
    unused: list[Measurement]
    unmatched: list[list[str]]

    def to_payload(self) -> dict[str, Any]:
        return {
            "values": self.values,
            "review": [asdict(m) for m in self.review],
            "unused": [asdict(m) for m in self.unused],
            "unmatched": self.unmatched,
        }


# --------------------------------------------------------------------------
# 정규화
# --------------------------------------------------------------------------
_KEEP = re.compile(r"[^0-9a-z가-힣%/]")

#: 그리스 문자를 이름으로 편다. `_KEEP` 이 이 글자들을 지우기 때문에, 접어 두지 않으면
#: `γ-GTP` 가 `gtp` 로 줄어 사전(`gammagtp`)과 어긋난다. 2026-09-03 채점 세트에서
#: 감마지티피 재현율이 69% 였던 이유가 이것이다 — 셋 중 하나를 그 표기로 인쇄했다.
_GREEK = {"γ": "gamma", "ɣ": "gamma", "α": "alpha", "β": "beta"}
_NUMBER = re.compile(r"[-+]?\d+(?:[.,]\d+)?")
_CENSORED = re.compile(r"[<>≤≥]")


def _normalize(text: str) -> str:
    """비교용 열쇠. 공백·기호·대소문자·전각을 지운다.

    `NFKC` 를 먼저 거는 이유는 검진표가 전각 영숫자(`ＡＳＴ`)를 쓰는 일이 있어서다.
    """
    folded = unicodedata.normalize("NFKC", text).lower()
    for glyph, name in _GREEK.items():
        folded = folded.replace(glyph, name)
    return _KEEP.sub("", folded)


def _candidates(label: str) -> list[str]:
    """검사명 하나에서 비교할 열쇠를 뽑는다.

    `AST (SGOT)` 는 `astsgot`·`ast`·`sgot` 셋 다로 찾아본다. 검진표가 옛 이름을
    괄호에 넣는 관행이 있어서, 괄호를 갈라 두지 않으면 사전을 두 배로 불려야 한다.
    """
    keys = [_normalize(label)]
    for inside in re.findall(r"[(\[（]([^)\]）]*)[)\]）]", label):
        keys.append(_normalize(inside))
    outside = re.split(r"[(\[（]", label)[0]
    keys.append(_normalize(outside))
    # 슬래시를 뺀 꼴도 찾아본다. `_KEEP` 이 `/` 를 남기는 것은 단위(`mg/dL`) 때문인데,
    # 검사명에서는 그게 사전과 어긋나게 만든다 — 인쇄된 `요알부민/크레아티닌비` 가
    # 사전의 `요알부민크레아티닌비` 와 안 맞아 2026-09-03 채점에서 10 개 중 7 개를
    # 놓쳤다. 사전을 슬래시 유무로 두 벌 만들지 않으려고 여기서 편다.
    keys += [key.replace("/", "") for key in list(keys) if "/" in key]
    return [k for k in dict.fromkeys(keys) if k]


def _build_index(source: dict[str, tuple[str, ...]]) -> dict[str, str]:
    index: dict[str, str] = {}
    for target, names in source.items():
        for name in names:
            index[_normalize(name)] = target
    return index


_FIELD_INDEX = _build_index(_ALIASES)
_UNUSED_INDEX = _build_index(_KNOWN_BUT_UNUSED)
_MISREAD_INDEX = {_normalize(name): target for name, target in _KNOWN_MISREADS.items()}


def _normalize_unit(raw: str) -> str:
    folded = unicodedata.normalize("NFKC", raw).strip().lower().replace(" ", "")
    return _UNIT_SYNONYMS.get(folded, folded)


# --------------------------------------------------------------------------
# DTO 에서 허용 범위를 가져온다 — 두 벌로 적지 않기 위해서다
# --------------------------------------------------------------------------
def _bounds() -> dict[str, tuple[float | None, float | None]]:
    """`AssessmentSummaryRequest` 의 `ge/gt/le/lt` 를 그대로 읽는다.

    여기에 숫자를 베껴 적으면 DTO 가 바뀔 때 조용히 어긋난다. 범위는 한 곳에만 산다.
    """
    out: dict[str, tuple[float | None, float | None]] = {}
    for name, info in AssessmentSummaryRequest.model_fields.items():
        low: float | None = None
        high: float | None = None
        for meta in info.metadata:
            if isinstance(meta, annotated_types.Ge):
                low = float(meta.ge)  # type: ignore[arg-type]
            elif isinstance(meta, annotated_types.Gt):
                low = float(meta.gt)  # type: ignore[arg-type]
            elif isinstance(meta, annotated_types.Le):
                high = float(meta.le)  # type: ignore[arg-type]
            elif isinstance(meta, annotated_types.Lt):
                high = float(meta.lt)  # type: ignore[arg-type]
        out[name] = (low, high)
    return out


_BOUNDS = _bounds()


# --------------------------------------------------------------------------
# 값 읽기
# --------------------------------------------------------------------------
def _parse_number(raw: str) -> float | None:
    """결과값 칸에서 숫자 하나를 꺼낸다. 못 꺼내면 `None`.

    `1,234` 의 쉼표는 천 단위 구분이고 `1,2` 의 쉼표는 소수점인 표기가 섞여 들어온다.
    소수점 뒤가 세 자리면 천 단위로 본다 — 유럽식 소수 쉼표를 쓰는 검진표는 없다.
    """
    text = unicodedata.normalize("NFKC", raw).strip()
    if not text:
        return None
    found = _NUMBER.search(text.replace(" ", ""))
    if found is None:
        return None
    token = found.group(0)
    if "," in token:
        head, _, tail = token.partition(",")
        token = head + tail if len(tail) == 3 else f"{head}.{tail}"
    try:
        return float(token)
    except ValueError:
        return None


def _parse_reference(raw: str) -> tuple[float, float] | None:
    """참고치 칸에서 인쇄된 구간을 꺼낸다. 숫자가 둘 미만이면 `None`.

    `이상 (정상: 74~99)` → `(74, 99)`. 한쪽만 적힌 `120 이하` 는 구간이 아니라
    비교로 읽히므로 쓰지 않는다 — 애매한 근거로 멀쩡한 행을 검토로 밀지 않는다.
    """
    numbers = [float(n.replace(",", "")) for n in _NUMBER.findall(unicodedata.normalize("NFKC", raw))]
    if len(numbers) < 2:
        return None
    return min(numbers), max(numbers)


def _overlaps(a: tuple[float, float], b: tuple[float, float]) -> bool:
    return a[0] <= b[1] and b[0] <= a[1]


# --------------------------------------------------------------------------
# 본체
# --------------------------------------------------------------------------
def _row_parts(row: list[str]) -> tuple[str, str, str, str]:
    """4열을 채운다. 모자라면 빈 문자열로 메운다 — 모델이 열을 빠뜨리는 일이 있다."""
    padded = [*row, "", "", "", ""]
    return padded[0].strip(), padded[1].strip(), padded[2].strip(), padded[3].strip()


def _scale_to_canonical_unit(target: str, value: float, raw_unit: str) -> tuple[float, str, str | None]:
    """단위를 정본으로 맞춘다. `(값, 단위, 사유)` — 사유가 있으면 검토로 간다."""
    spec = _UNITS.get(target)
    if spec is None:
        return value, raw_unit, None
    unit = _normalize_unit(raw_unit)
    if not unit or unit == spec.canonical:
        return value, spec.canonical, None
    factor = spec.conversions.get(unit)
    if factor is None:
        # 환산하지 못했으므로 **값도 단위도 원문 그대로** 돌려준다. 정본 단위를 붙이면
        # 화면에서 "42 %" 처럼 안 바뀐 값에 바뀐 단위가 붙어 더 헷갈린다.
        return value, raw_unit, f"단위가 {spec.canonical} 이 아니라 {raw_unit} 입니다."
    return value * factor, spec.canonical, None


def _reference_conflict(target: str, raw_reference: str) -> str | None:
    """인쇄된 참고치가 이 검사의 것으로 보이지 않으면 사유를 돌려준다.

    **이름 오독을 잡는 관문이다.** 기록된 사례가 `요소질소`(참고치 8~20)가 `요산`
    (기대 2.0~7.5)으로 읽힌 것이고, 그 둘은 구간이 전혀 겹치지 않는다.
    """
    printed = _parse_reference(raw_reference)
    expected = _EXPECTED_REFERENCE.get(target)
    if printed is None or expected is None or _overlaps(printed, expected):
        return None
    return (
        f"인쇄된 참고치({printed[0]:g}~{printed[1]:g})가 이 검사에서 기대하는 "
        f"범위({expected[0]:g}~{expected[1]:g})와 겹치지 않습니다. 검사명을 잘못 읽었을 수 있습니다."
    )


def _bounds_conflict(target: str, value: float) -> str | None:
    low, high = _BOUNDS.get(target, (None, None))
    if (low is not None and value < low) or (high is not None and value > high):
        return f"값 {value:g} 이 입력 허용 범위를 벗어납니다."
    return None


def _read_value(raw_value: str) -> tuple[float | None, str | None]:
    """결과값 칸을 읽는다. `(값, 사유)` — 사유가 있으면 값은 쓰지 않는다."""
    if _CENSORED.search(raw_value):
        # `<5` 는 "5 미만" 이지 5 가 아니다. 점추정으로 바꾸면 없는 정밀도를 지어내는 것이다.
        return None, "부등호가 붙은 값이라 그대로 쓸 수 없습니다."
    value = _parse_number(raw_value)
    if value is None:
        return None, "결과값에서 숫자를 읽지 못했습니다."
    return value, None


def _unused_row(name: str, label: str, raw_value: str, raw_unit: str, row: list[str]) -> tuple[str, Measurement]:
    value = _parse_number(raw_value)
    return "unused", Measurement(
        field=name,
        label=label,
        value=value if value is not None else float("nan"),
        unit=raw_unit,
        source=list(row),
        reason="모델이 쓰지 않는 검사입니다.",
    )


def _read_row(row: list[str]) -> tuple[str, Measurement] | None:
    """행 하나를 읽는다. `(분류, 결과)` 또는 사전에 없으면 `None`.

    분류는 `"value"`(수치로 쓸 수 있음) · `"review"`(사람이 봐야 함) ·
    `"unused"`(읽었지만 모델 입력이 아님) 셋이다. 관문을 하나라도 못 넘으면
    **수치가 되지 않는다** — 통과 못 한 것을 버리지 않고 검토로 넘긴다.
    """
    label, raw_value, raw_unit, raw_reference = _row_parts(row)
    if not label:
        return None

    keys = _candidates(label)
    unused = next((_UNUSED_INDEX[key] for key in keys if key in _UNUSED_INDEX), None)
    if unused is not None:
        return _unused_row(unused, label, raw_value, raw_unit, row)

    target = next((_FIELD_INDEX[key] for key in keys if key in _FIELD_INDEX), None)
    if target is not None:
        return _measure(target, label, raw_value, raw_unit, raw_reference, row)

    misread = next((_MISREAD_INDEX[key] for key in keys if key in _MISREAD_INDEX), None)
    if misread is None:
        return None
    # 관측된 오독이다. **값을 잃지도, 말없이 채우지도 않는다** — 관문은 그대로 태우고
    # 통과했더라도 검토로 보낸다. 사람이 원본을 보면 1초에 가리는 종류의 물음이다.
    _, measurement = _measure(misread, label, raw_value, raw_unit, raw_reference, row)
    measurement.reason = measurement.reason or (
        f"'{label}' 은 '{_ALIASES[misread][0]}' 을 잘못 읽은 것으로 보입니다. 원본과 맞는지 확인해 주세요."
    )
    return "review", measurement


def _measure(
    target: str,
    label: str,
    raw_value: str,
    raw_unit: str,
    raw_reference: str,
    row: list[str],
) -> tuple[str, Measurement]:
    """관문 셋(값·단위·참고치·범위)을 태운다. `("value" | "review", 결과)`."""
    value, reason = _read_value(raw_value)
    if value is None:
        return "review", Measurement(target, label, float("nan"), raw_unit, list(row), reason or "")

    value, unit, reason = _scale_to_canonical_unit(target, value, raw_unit)
    reason = reason or _reference_conflict(target, raw_reference) or _bounds_conflict(target, value)
    kind = "review" if reason is not None else "value"
    return kind, Measurement(target, label, round(value, 4), unit, list(row), reason)


#: 혈압을 한 칸에 `120/80` 으로 찍는 검진표가 있다. 이건 행 하나가 값 둘이라
#: 일반 경로로는 못 읽으므로 앞에서 갈라 준다.
_BP_LABELS = ("혈압", "bloodpressure", "bp")
_BP_PAIR = re.compile(r"^\s*(\d{2,3})\s*/\s*(\d{2,3})\s*$")


def _split_blood_pressure(row: list[str]) -> list[list[str]] | None:
    label, raw_value, raw_unit, raw_reference = _row_parts(row)
    key = _normalize(label)
    if not any(key == name or key.startswith(name) for name in _BP_LABELS):
        return None
    paired = _BP_PAIR.match(unicodedata.normalize("NFKC", raw_value))
    if paired is None:
        return None
    return [
        ["수축기혈압", paired.group(1), raw_unit or "mmHg", raw_reference],
        ["이완기혈압", paired.group(2), raw_unit or "mmHg", raw_reference],
    ]


def _iter_rows(tables: list[dict[str, Any]] | None) -> list[list[str]]:
    """표들을 행 목록으로 편다. 혈압 한 칸(`120/80`)은 여기서 두 행으로 갈린다."""
    rows: list[list[str]] = []
    for table in tables or []:
        for row in table.get("rows") or []:
            if not isinstance(row, list) or not row:
                continue
            cells = [str(cell) for cell in row]
            rows.extend(_split_blood_pressure(cells) or [cells])
    return rows


def _resolve_duplicates(
    duplicated: dict[str, list[Measurement]],
    accepted: dict[str, Measurement],
    review: list[Measurement],
) -> None:
    """같은 항목이 여러 행에 나온 경우를 정리한다.

    값이 다르면 **둘 다 검토로 넘긴다.** 실제로 `요산` 행이 둘 나온 적이 있고
    (하나는 BUN 오독), 그때 어느 쪽이 맞는지는 이 코드가 알 수 없다.
    """
    for name, rows in duplicated.items():
        accepted.pop(name, None)
        if len({row.value for row in rows}) == 1:
            # 같은 값이면 같은 검사를 두 번 뽑은 것이다. 하나만 살린다.
            accepted[name] = rows[0]
            continue
        for row in rows:
            row.reason = f"같은 항목이 {len(rows)}개 행에 서로 다른 값으로 나왔습니다. 어느 쪽이 맞는지 확인해 주세요."
            review.append(row)


def extract(tables: list[dict[str, Any]] | None) -> ExtractionResult:
    """인식 결과의 `tables` 를 예측 입력 수치로 옮긴다. **`values` 만 예측에 쓴다.**"""
    accepted: dict[str, Measurement] = {}
    duplicated: dict[str, list[Measurement]] = {}
    review: list[Measurement] = []
    unused: list[Measurement] = []
    unmatched: list[list[str]] = []

    for cells in _iter_rows(tables):
        read = _read_row(cells)
        if read is None:
            unmatched.append(cells)
            continue
        kind, measurement = read
        if kind == "unused":
            unused.append(measurement)
        elif kind == "review":
            review.append(measurement)
        elif measurement.field in accepted:
            duplicated.setdefault(measurement.field, [accepted[measurement.field]]).append(measurement)
        else:
            accepted[measurement.field] = measurement

    _resolve_duplicates(duplicated, accepted, review)

    return ExtractionResult(
        values={name: row.value for name, row in accepted.items()},
        review=review,
        unused=unused,
        unmatched=unmatched,
    )
