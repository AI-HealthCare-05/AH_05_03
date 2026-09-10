"""남긴 건강기록을 **판정 폼 입력값으로** 옮긴다. 옮겨도 되는 것만 옮긴다.

## 왜 필요한가

값이 판정 폼에 들어오는 길이 사실상 **검진표 OCR 하나**였다. 기록 종류가 열넷인데
`RecordDetail` 이 읽는 것은 `payload.inputs` 뿐이고, 그 칸은 `recordType:
"assessment"`(판정 스냅샷)에만 있다. 그래서 혈압·혈당·체성분·검사값을 아무리 남겨도
판정 화면에서 같은 수치를 손으로 다시 쳐야 했다 — `ocr_measurements` 머리말이 검진표에
대해 적은 그 문제가, 손으로 남긴 기록에서 그대로 반복되고 있었다.

## 왜 서버에 있는가

옮기려면 **이름을 필드에 잇는 판단**이 필요하고, 그 판단은 이미 `ocr_measurements`
에 있다(표기 100개 → 판정 칸 20개, 관문 셋). 클라이언트에 사전을 복사하면 같은 판단이
두 곳에 살고 한쪽만 고쳐진다(AGENTS.md §2-5). 기록의 정본도 PostgreSQL 이므로
(ADR-011) 서버에서 읽어 서버에서 옮기는 것이 경로가 가장 짧다.

`lab_result` 는 그래서 **직접 매핑하지 않는다.** 자유 텍스트 검사명을 1행 표로 만들어
`ocr_measurements.extract` 에 그대로 태운다. 좁은 사전·단위·참고치·DTO 범위·중복 관문을
전부 그대로 받는다 — `크레아틴` 은 검진표에서든 손으로 적었든 똑같이 안 잡힌다.

## 필드 이름이 여러 개인 것을 여기서 흡수한다

같은 값에 이름이 둘이었다. 화면마다 writer 가 달랐기 때문이다.

    수축기   건강기록 작성 `systolic`   ·  봄이 챗봇 `systolicMmHg`
    혈당     건강기록 작성 `value`      ·  봄이 챗봇 `valueMgDl`

2026-09-10 에 writer 를 단위 붙은 쪽으로 통일했지만 **그전에 저장된 기록이 남는다.**
이 모듈이 별칭을 승계하므로 데이터 마이그레이션은 하지 않는다 — 마이그레이션은 되돌릴
수 없고, 읽을 때 흡수하는 것은 언제든 지울 수 있다.

## 옮기지 않는 것

* **통증 다이어리(`pain`)** — 부위·강도·양상은 판정 모델의 입력이 아니다. 대응하는
  폼 칸이 없고, 억지로 이으면 모델이 안 보는 값을 사용자가 채우게 된다(유령 입력).
* **판정 스냅샷(`assessment`)** — 이미 다른 길이 있다. 두 경로가 같은 칸을 채우면
  어느 쪽이 이겼는지 화면이 설명할 수 없다.
* **복약·예방접종·검진 이름·메모** — 수치가 아니다.

## 식후 혈당을 공복혈당 칸에 넣지 않는다

**이것이 이 모듈에서 가장 위험한 자리다.** 식후 2시간 혈당은 정상인도 140 을 넘고,
`fasting_glucose` 칸에 넣으면 그 사람은 당뇨로 판정된다(126 이상). 그래서 `timing` 이
공복이라고 **명시된 것만** 옮기고, 비어 있으면 옮기지 않는다 — 모르는 것을 공복으로
가정하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.services import ocr_measurements

#: 같은 값의 옛 이름 → 판정 칸. writer 통일(2026-09-10) 전에 저장된 기록을 위한 승계표다.
#: **새 이름을 여기 더하지 마라.** 새로 쓰는 곳은 아래 `_CANONICAL` 을 쓴다.
_LEGACY_ALIASES: dict[str, dict[str, str]] = {
    "blood_pressure": {"systolic": "sbp", "diastolic": "dbp"},
    # `value` 는 `lab_result` 에서도 쓰이는 이름이라 종류 안에서만 푼다.
    "blood_glucose": {"value": "fasting_glucose", "glucose": "fasting_glucose"},
}

#: 지금 writer 가 쓰는 이름 → 판정 칸.
_CANONICAL: dict[str, dict[str, str]] = {
    "blood_pressure": {"systolicMmHg": "sbp", "diastolicMmHg": "dbp"},
    "blood_glucose": {"valueMgDl": "fasting_glucose"},
    "body_measurement": {"weightKg": "weight_kg", "heightCm": "height_cm", "waistCm": "waist_cm"},
    "sleep": {"hours": "sleep_hours", "sleepHours": "sleep_hours"},
}

#: `timing` 이 이 값일 때만 혈당을 `fasting_glucose` 로 옮긴다. 위 머리말 참조.
_FASTING_TIMINGS = frozenset({"fasting", "공복"})

#: 챌린지 측정이 쓰는 모양. `payload.values` 의 키가 **이미 판정 칸 이름**이다
#: (`frontend/.../snapshots.ts` 의 `TREND_SERIES`). 세 writer 중 유일하게 처음부터
#: 정본 모양이었고, 나머지를 여기로 수렴시킨 것이다.
_VALUES_KEY = "values"


@dataclass(frozen=True)
class PrefilledValue:
    """판정 칸 하나와 그 값이 어디서 왔는지."""

    field: str
    value: float
    #: 그 값을 **언제 쟀는가.** 화면이 반드시 같이 보여야 한다 — 석 달 전 혈압으로
    #: 오늘 판정하면 그것은 오늘의 답이 아니다.
    measured_at: str
    record_type: str
    record_id: str | None = None


def _bounds_ok(field: str, value: float) -> bool:
    """DTO 범위 안인가. 범위는 `AssessmentSummaryRequest` 한 곳에만 산다."""
    return ocr_measurements.bounds_conflict(field, value) is None


def _numeric(raw: Any) -> float | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    if isinstance(raw, str):
        try:
            return float(raw.strip())
        except ValueError:
            return None
    return None


def _row(name: Any, value: Any, unit: Any, reference: Any) -> list[str] | None:
    """`ocr_measurements` 가 받는 4열 행. 이름이나 값이 없으면 행을 만들지 않는다."""
    label = str(name or "").strip()
    if not label or value is None or str(value).strip() == "":
        return None
    return [label, str(value), str(unit or ""), str(reference or "")]


def _from_labels(payload: dict[str, Any]) -> dict[str, float]:
    """검사명이 붙은 값들을 표로 만들어 `ocr_measurements` 에 태운다.

    사전과 관문을 그대로 받는 것이 요점이다. 여기서 이름을 직접 풀면 검진표 경로와
    손기록 경로가 **다른 사전**을 갖게 되고, 한쪽에서만 막히는 오독이 생긴다.

    두 모양을 받는다.

    * `{testName, value, unit}` — 검사 결과 한 줄(`lab_result`)
    * `{items: [{testName, value, unit, judgment}, ...]}` — 검진표 한 장
      (`health_screening`). 인쇄된 참고치가 `judgment` 칸에 온다.

    **`items` 를 빠뜨렸던 자리다.** `lab_result` 만 태우고 있어서, 검진표에서 읽은
    21개 항목이 화면에는 다 보이는데 판정에는 한 칸도 안 넘어갔다 — 사용자가
    "데이터는 있는데 판정에서 안 보인다" 고 한 그 증상이다(2026-09-10).
    """
    rows: list[list[str]] = []

    single = _row(payload.get("testName"), payload.get("value"), payload.get("unit"), payload.get("reference"))
    if single:
        rows.append(single)

    items = payload.get("items")
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            # 참고치 칸의 이름이 자료마다 다르다. 없으면 빈 칸으로 두면 되고,
            # `ocr_measurements` 는 참고치를 *있으면 쓰는* 보조 수단으로만 본다.
            reference = item.get("reference") or item.get("judgment") or item.get("range")
            built = _row(item.get("testName"), item.get("value"), item.get("unit"), reference)
            if built:
                rows.append(built)

    if not rows:
        return {}
    return dict(ocr_measurements.extract([{"rows": rows}]).values)


def fields_for(record_type: str, payload: dict[str, Any]) -> dict[str, float]:
    """기록 하나에서 판정 칸 값들을 뽑는다. 통과하지 못한 것은 그냥 빠진다.

    **읽은 행보다 정본 맵이 이긴다.** 검진표는 두 겹으로 저장된다 — OCR 이 읽은
    행(`items`)과 판정 칸 이름으로 정리한 맵(`values`). 사용자가 수치를 고치면
    고친 값은 `values` 에 들어가므로, 둘이 다르면 `values` 가 맞는 값이다.
    `items` 를 나중에 덮게 두면 **고친 값이 원본으로 되돌아간다.**
    """
    out: dict[str, float] = {}

    # **낮은 우선순위부터 쌓는다.** 같은 칸을 세 곳이 채울 수 있어서, 순서를
    # 뒤집으면 고친 값이 조용히 원본으로 되돌아간다.
    #
    #     ① 칸 이름이 붙은 payload 키(옛 별칭 포함) — 가장 낮다
    #     ② OCR 이 읽은 행 — 사전·관문을 통과한 것
    #     ③ 판정 칸 이름으로 정리된 정본 맵 — 사용자가 고친 값이 여기 있다
    mapping = {**_LEGACY_ALIASES.get(record_type, {}), **_CANONICAL.get(record_type, {})}
    for key, field in mapping.items():
        number = _numeric(payload.get(key))
        if number is None or not _bounds_ok(field, number):
            continue
        # 혈당은 공복이라고 적힌 것만. 모르는 것을 공복으로 가정하지 않는다.
        if field == "fasting_glucose":
            timing = str(payload.get("timing") or "").strip().lower()
            if timing not in _FASTING_TIMINGS:
                continue
        out[field] = number

    # 검사명이 붙은 값은 사전·관문을 타야 한다. 검진표(`items`)와 검사 한 줄
    # (`testName`) 둘 다 여기로 온다.
    if record_type in {"lab_result", "health_screening"} or isinstance(payload.get("items"), list):
        out.update(_from_labels(payload))

    values = payload.get(_VALUES_KEY)
    if isinstance(values, dict):
        for field, raw in values.items():
            number = _numeric(raw)
            if number is not None and _bounds_ok(str(field), number):
                out[str(field)] = number

    return out


def build(records: list[dict[str, Any]]) -> list[PrefilledValue]:
    """기록 목록에서 판정 폼 값을 만든다. **칸마다 가장 최근 것 하나.**

    같은 칸을 여러 기록이 채울 수 있다(어제 혈압, 지난주 혈압). 가장 최근 것을 쓰고
    나머지는 버린다 — 평균을 내지 않는다. 판정은 "지금 상태" 를 묻는 것이고, 평균은
    어느 시점의 값도 아니어서 사용자가 원본과 대조할 수 없다.

    `records` 는 `recorded_at` 문자열을 들고 있어야 한다. 정렬을 호출자에게 맡기지
    않는 이유는, 정렬이 빠지면 조용히 **오래된 값이 이기는** 결과가 나오기 때문이다.
    """
    best: dict[str, PrefilledValue] = {}
    ordered = sorted(records, key=lambda r: str(r.get("recorded_at") or ""))
    for record in ordered:
        record_type = str(record.get("record_type") or "")
        # 위 머리말의 "옮기지 않는 것".
        if record_type in {"pain", "assessment"}:
            continue
        payload = record.get("payload")
        if not isinstance(payload, dict):
            continue
        measured_at = str(record.get("recorded_at") or "")
        for field, value in fields_for(record_type, payload).items():
            # 오름차순으로 훑으므로 나중에 덮어쓰는 것이 늘 더 최근이다.
            best[field] = PrefilledValue(
                field=field,
                value=value,
                measured_at=measured_at,
                record_type=record_type,
                record_id=str(record.get("id")) if record.get("id") is not None else None,
            )

    # 공복혈당이 실렸으면 폼의 `is_fasting` 도 같이 켠다. 그 칸이 비어 있으면 폼이
    # "공복 여부 불명" 으로 읽고 임계값을 다르게 적용한다.
    if "fasting_glucose" in best:
        source = best["fasting_glucose"]
        best["is_fasting"] = PrefilledValue(
            field="is_fasting",
            value=1.0,
            measured_at=source.measured_at,
            record_type=source.record_type,
            record_id=source.record_id,
        )

    return sorted(best.values(), key=lambda v: v.field)
