"""OCR 토큰을 검진 항목 행으로 조립한다.

검진표는 표라서 y로 행을 묶고 x로 열을 나눈다. 토큰마다 역할을 정하는데,
엔진이 확실하게 읽어주는 것부터 쓴다.

  단위(mg/dL·g/dL·U/L·mmHg)와 참고치(0~200·60이상)는 신뢰도 1.00으로 나온다.
  수치도 1.00으로 나온다. 한글 라벨만 깨진다.

그래서 "라벨이 뭐였는지"를 한글에만 의존하지 않고 단위·참고치·라틴 접두사를
함께 넘겨 lexicon.guess_item이 판단하게 한다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.ocr.engine import OcrToken
from app.services.ocr.lexicon import ItemGuess, guess_item, parse_value

#: 신뢰도가 이 값 미만이면 사용자 확인을 요구한다.
#: 합성 픽스처 3종 실측에서 이 선을 넘긴 값은 전부 정답이었다.
DEFAULT_REVIEW_THRESHOLD = 0.80

_UNIT = re.compile(r"^(mg\s*/\s*dl|g\s*/\s*dl|u\s*/\s*l|mmhg|ml/min|%)$", re.IGNORECASE)
_NUMBER = re.compile(r"^\d{1,4}(\.\d{1,2})?$")
_RANGE = re.compile(r"[~∼―]|이상|이하|미만|초과")
_DATE = re.compile(r"(20\d{2})\s*[-.\s/]\s*(\d{1,2})\s*[-.\s/]\s*(\d{1,2})")


@dataclass
class ExtractedRow:
    """확정 전 후보 행."""

    item_code: str | None
    item_label: str | None
    raw_label: str
    value: float | None
    raw_value: str | None
    unit: str | None
    reference: str | None
    confidence: float
    needs_review: bool
    #: 항목을 무엇으로 맞췄는지. 검수 화면에서 근거로 보여준다.
    signals: list[str]


def _clean_number(text: str) -> str:
    return re.sub(r"[^\d.]", "", text).strip(".")


def _is_unit(text: str) -> bool:
    return bool(_UNIT.match(text.replace(" ", "")))


def _is_number(text: str) -> bool:
    # 슬래시가 든 토큰은 단위가 깨진 것이다. "7p/6"(g/dL 오인식)을
    # _clean_number가 "76"으로 만들어 수치로 오인하던 문제를 막는다.
    if "/" in text:
        return False
    return bool(_NUMBER.match(_clean_number(text)))


def _is_range(text: str) -> bool:
    return bool(_RANGE.search(text))


def group_rows(tokens: list[OcrToken]) -> list[list[OcrToken]]:
    """y가 겹치는 토큰을 한 행으로 묶는다.

    고정 픽셀이 아니라 토큰 높이를 기준으로 삼는다. 문서 해상도가 달라도
    같은 규칙이 통한다.
    """
    if not tokens:
        return []

    ordered = sorted(tokens, key=lambda t: (t.center_y, t.left))
    median_height = sorted(t.height for t in ordered)[len(ordered) // 2] or 1.0
    tolerance = median_height * 0.6

    rows: list[list[OcrToken]] = []
    for token in ordered:
        if rows and abs(rows[-1][-1].center_y - token.center_y) <= tolerance:
            rows[-1].append(token)
        else:
            rows.append([token])
    return [sorted(row, key=lambda t: t.left) for row in rows]


def find_measured_date(tokens: list[OcrToken]) -> str | None:
    """결과지에서 검진일을 찾는다."""
    for token in tokens:
        m = _DATE.search(token.text)
        if not m:
            continue
        year, month, day = m.groups()
        try:
            iso = f"{year}-{int(month):02d}-{int(day):02d}"
            # 형식만 확인한다. 실제 유효성은 Pydantic이 본다.
            if 1 <= int(month) <= 12 and 1 <= int(day) <= 31:
                return iso
        except ValueError:
            continue
    return None


@dataclass
class _RowDraft:
    """항목 배정 전의 한 행."""

    raw_label: str
    value_token: OcrToken
    unit: str | None
    reference: str | None
    label_confidence: float


def _draft_row(row: list[OcrToken]) -> _RowDraft | None:
    """한 행의 토큰에 역할을 부여한다. 수치가 없으면 표 항목이 아니다."""
    value_token: OcrToken | None = None
    unit_token: OcrToken | None = None
    reference_token: OcrToken | None = None
    label_parts: list[OcrToken] = []

    for token in row:
        if _is_unit(token.text):
            unit_token = token
        elif _is_range(token.text):
            # 참고치는 보통 가장 오른쪽에 있다
            if reference_token is None or token.left > reference_token.left:
                reference_token = token
        elif _is_number(token.text):
            # 첫 숫자를 결과값으로 본다. 참고치 안의 숫자는 위에서 걸러진다.
            if value_token is None:
                value_token = token
        else:
            label_parts.append(token)

    if value_token is None:
        return None

    return _RowDraft(
        raw_label=" ".join(t.text for t in label_parts if t.left < value_token.left).strip(),
        value_token=value_token,
        unit=unit_token.text if unit_token else None,
        reference=reference_token.text if reference_token else None,
        label_confidence=min((t.confidence for t in label_parts), default=0.0),
    )


def extract_rows(
    tokens: list[OcrToken],
    *,
    review_threshold: float = DEFAULT_REVIEW_THRESHOLD,
) -> list[ExtractedRow]:
    """토큰 목록에서 검진 항목 행을 뽑는다.

    같은 항목 코드는 한 번만 배정한다. 한글이 깨져 여러 행이 같은 항목에
    붙으려 할 때, 점수가 높은 행이 먼저 차지하고 나머지는 검수로 넘어간다.
    """
    drafts = [d for d in (_draft_row(row) for row in group_rows(tokens)) if d is not None]

    def _guess(draft: _RowDraft, exclude: set[str] | None = None) -> ItemGuess | None:
        return guess_item(
            label_text=draft.raw_label,
            unit_text=draft.unit,
            reference_text=draft.reference,
            exclude=exclude,
        )

    # 점수 높은 후보가 코드를 먼저 차지한다
    def _initial_score(draft: _RowDraft) -> float:
        guess = _guess(draft)
        return guess.score if guess is not None else 0.0

    taken: set[str] = set()
    assignments: dict[int, ItemGuess | None] = {}
    for draft in sorted(drafts, key=_initial_score, reverse=True):
        # exclude를 반영해 다시 판단한다. 이미 배정된 코드는 후보에서 빠진다.
        guess = _guess(draft, taken)
        if guess is not None:
            taken.add(guess.item.code)
        assignments[id(draft)] = guess

    rows: list[ExtractedRow] = []
    for draft in drafts:
        guess = assignments.get(id(draft))
        item = guess.item if guess else None
        value = parse_value(item, draft.value_token.text) if item is not None else None
        confidence = min(draft.value_token.confidence, draft.label_confidence or 1.0)

        rows.append(
            ExtractedRow(
                item_code=item.code if item else None,
                item_label=item.label if item else None,
                raw_label=draft.raw_label,
                value=value,
                raw_value=_clean_number(draft.value_token.text) or None,
                unit=draft.unit,
                reference=draft.reference,
                confidence=round(confidence, 3),
                needs_review=item is None or value is None or confidence < review_threshold,
                signals=list(guess.signals) if guess else [],
            )
        )
    return rows
