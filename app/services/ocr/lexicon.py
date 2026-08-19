"""국가건강검진 결과지 항목 사전.

OCR 정확도에 기대지 않기 위한 장치다. 항목명은 유한한 고정 집합이므로
인식 결과를 여러 단서로 붙인다.

단서를 셋 쓰는 이유는 엔진 특성 때문이다. RapidOCR(PP-OCR 중국어 모델)은
수치·라틴 문자·참고치를 거의 완벽하게 읽지만 한글은 못 읽는다. 실측:

    185  mg/dL  0~200      → 값·단위·참고치 신뢰도 1.00
    HDL-引                 → 라틴 접두사는 살아남음
    望生 (혈색소)            → 한글은 전멸

그래서 한글 라벨 하나에 의존하지 않고 라틴 접두사 · 단위 · 참고치를 함께 본다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class CheckupItem:
    """검진 항목 정의."""

    code: str
    label: str
    unit: str
    #: 입력 허용 범위. 의학적 정상 판정이 아니라 형식 검증이다.
    min_value: float
    max_value: float
    #: 결과지 표기 변형
    aliases: tuple[str, ...] = ()
    #: 라틴 접두사. 한글이 깨져도 이건 살아남는 경우가 많다.
    latin_prefixes: tuple[str, ...] = ()
    #: 흔한 참고치 표기. 검진기관마다 달라 보조 단서로만 쓴다.
    reference_hints: tuple[str, ...] = ()


CHECKUP_ITEMS: tuple[CheckupItem, ...] = (
    CheckupItem(
        "total_cholesterol",
        "총콜레스테롤",
        "mg/dL",
        50,
        500,
        ("총콜레스테롤", "총콜레스톨", "총 콜레스테롤"),
        (),
        ("0~200", "0-200", "200미만"),
    ),
    CheckupItem(
        "hdl_cholesterol",
        "HDL콜레스테롤",
        "mg/dL",
        5,
        200,
        ("HDL콜레스테롤", "HDL-콜레스테롤"),
        ("HDL",),
        ("60이상", "40~60", "60 이상"),
    ),
    CheckupItem(
        "ldl_cholesterol",
        "LDL콜레스테롤",
        "mg/dL",
        5,
        400,
        ("LDL콜레스테롤", "LDL-콜레스테롤"),
        ("LDL",),
        ("0~130", "130미만", "0-130"),
    ),
    CheckupItem(
        "triglyceride",
        "트리글리세라이드",
        "mg/dL",
        10,
        1000,
        ("트리글리세라이드", "중성지방"),
        (),
        ("0~150", "150미만", "0-150"),
    ),
    CheckupItem(
        "fasting_glucose",
        "공복혈당",
        "mg/dL",
        20,
        600,
        ("공복혈당", "식전혈당", "공복시혈당"),
        (),
        ("70~100", "100미만", "100 미만"),
    ),
    CheckupItem("hemoglobin", "혈색소", "g/dL", 3, 25, ("혈색소", "헤모글로빈"), ("HB",), ("13~16.5", "12~15.5")),
    CheckupItem("bun", "요소질소", "mg/dL", 1, 100, ("요소질소", "혈중요소질소"), ("BUN",), ("8~20", "8-20")),
    CheckupItem(
        "creatinine",
        "크레아티닌",
        "mg/dL",
        0.1,
        15,
        ("크레아티닌", "혈청크레아티닌"),
        (),
        ("0~1.5", "1.5이하", "0-1.5"),
    ),
    CheckupItem("uric_acid", "요산", "mg/dL", 0.5, 20, ("요산",), (), ("2.6~7.2", "3.5~7.2")),
    CheckupItem("ast", "AST", "U/L", 1, 2000, ("AST", "AST(SGOT)", "SGOT"), ("AST", "SGOT"), ("0~40", "40이하")),
    CheckupItem("alt", "ALT", "U/L", 1, 2000, ("ALT", "ALT(SGPT)", "SGPT"), ("ALT", "SGPT"), ("0~35", "35이하")),
    CheckupItem("ggt", "감마지티피", "U/L", 1, 2000, ("감마지티피", "감마GTP"), ("GTP", "GGT"), ("11~63", "8~35")),
    CheckupItem("systolic_bp", "수축기혈압", "mmHg", 40, 300, ("수축기혈압", "수축기"), (), ("120미만",)),
    CheckupItem("diastolic_bp", "이완기혈압", "mmHg", 20, 200, ("이완기혈압", "이완기"), (), ("80미만",)),
)

_BY_CODE = {item.code: item for item in CHECKUP_ITEMS}


def find_item(code: str) -> CheckupItem | None:
    return _BY_CODE.get(code)


_NON_WORD = re.compile(r"[^가-힣A-Za-z]")


def normalize(raw: str) -> str:
    """공백·괄호·하이픈을 지우고 대문자로 맞춘다."""
    return _NON_WORD.sub("", raw).upper()


def _levenshtein(a: str, b: str) -> int:
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return 1 - _levenshtein(a, b) / max(len(a), len(b))


@dataclass
class ItemGuess:
    """항목 추정 결과."""

    item: CheckupItem
    score: float
    #: 무엇으로 맞췄는지. 검수 화면에서 사용자에게 근거를 보여줄 때 쓴다.
    signals: list[str] = field(default_factory=list)


def _range_key(raw: str) -> str:
    """참고치 표기를 비교 가능한 형태로 정규화한다. '0 ~ 200' → '0~200'"""
    return re.sub(r"\s+", "", raw).replace("-", "~").replace("―", "~").replace("∼", "~")


def _score_label(item: CheckupItem, norm_label: str) -> tuple[float, str | None]:
    """한글 라벨 퍼지 매칭 — 최대 0.6"""
    if len(norm_label) < 2:
        return 0.0, None
    best = max((_similarity(norm_label, normalize(a)) for a in item.aliases), default=0.0)
    # 짧은 토큰은 편집거리 1에도 유사도가 높다. 기준을 올린다.
    floor = 0.85 if len(norm_label) <= 4 else 0.6
    if best < floor:
        return 0.0, None
    return best * 0.6, f"label:{best:.2f}"


def _score_item(item: CheckupItem, *, norm_label: str, ref_key: str, unit: str) -> ItemGuess | None:
    """항목 하나에 대한 점수와 근거를 계산한다."""
    score, label_signal = _score_label(item, norm_label)
    signals = [label_signal] if label_signal else []

    # 라틴 접두사 — 0.3. 한글이 깨져도 살아남는 단서다.
    if item.latin_prefixes and norm_label and any(p in norm_label for p in item.latin_prefixes):
        score += 0.3
        signals.append("latin")

    # 참고치 일치 — 0.35.
    # "13~16.5"처럼 항목마다 고유한 값이라 단독으로도 식별력이 있다.
    # 실측에서 g/dL이 "7p/6"으로 깨져 단위 단서를 잃은 혈색소 행이
    # 참고치만으로 살아나야 했다. 두 항목이 같은 참고치를 쓰면
    # guess_item의 1·2위 근접 검사가 잡아낸다.
    if ref_key and any(_range_key(h) == ref_key for h in item.reference_hints):
        score += 0.35
        signals.append("reference")

    # 단위 불일치는 감점. g/dL와 mg/dL를 섞으면 자릿수가 바뀐다.
    if unit:
        if unit == item.unit.lower():
            score += 0.1
            signals.append("unit")
        else:
            score -= 0.25

    return ItemGuess(item=item, score=score, signals=signals) if score > 0 else None


def guess_item(
    *,
    label_text: str,
    unit_text: str | None,
    reference_text: str | None,
    exclude: set[str] | None = None,
) -> ItemGuess | None:
    """라벨·단위·참고치를 종합해 항목을 추정한다.

    한 단서만으로 확정하지 않는다. 한글 라벨이 깨지는 엔진에서는 라틴 접두사와
    참고치가 실질적인 식별자가 된다.

    Args:
        exclude: 이미 다른 행에 배정된 코드. 같은 항목이 두 행에 붙는 것을 막는다.
    """
    exclude = exclude or set()
    norm_label = normalize(label_text)
    ref_key = _range_key(reference_text) if reference_text else ""
    unit = (unit_text or "").strip().lower()

    scored = [
        guess
        for item in CHECKUP_ITEMS
        if item.code not in exclude
        and (guess := _score_item(item, norm_label=norm_label, ref_key=ref_key, unit=unit)) is not None
    ]
    if not scored:
        return None
    scored.sort(key=lambda g: g.score, reverse=True)
    top = scored[0]
    if top.score < 0.35:
        return None
    # 1·2위가 붙어 있으면 확정하지 않는다. HDL/LDL 혼동을 막는 장치다.
    if len(scored) > 1 and top.score - scored[1].score < 0.1:
        return None
    return top


_NUMBER = re.compile(r"^\d{1,4}(\.\d{1,2})?$")


def parse_value(item: CheckupItem, raw: str) -> float | None:
    """수치를 파싱하고 항목별 허용 범위로 검증한다."""
    cleaned = re.sub(r"[^\d.]", "", raw).strip(".")
    if not _NUMBER.match(cleaned):
        return None
    value = float(cleaned)
    if not (item.min_value <= value <= item.max_value):
        return None
    return value
