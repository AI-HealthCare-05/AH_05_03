"""판정 폼이 보내는 필드명이 요청 DTO 에 실제로 있는지.

## 왜 파이썬이 TS 를 읽는가

`frontend/src/features/assessment/fields.ts` 의 `FIELD_GROUPS` 는 **손으로 쓴 목록**이고,
`app/dtos/assessment_summary.py` 의 `AssessmentSummaryRequest` 가 그것을 받는다. 둘이
어긋나는 방식이 두 가지인데 **둘 다 조용하다.**

* 폼에만 있는 이름 → 서버 DTO 가 `extra="forbid"` 라 **422** 다. 사용자는 판정 버튼을
  눌렀는데 "입력을 확인해 주세요" 만 본다.
* DTO 에만 있는 이름 → 그 값을 물어볼 자리가 화면에 없다. 정확도를 그냥 버린다.

타입 검사로는 못 잡는다. 프런트가 서버 스키마를 import 하지 않기 때문이고, 그건 의도된
경계다(`frontend/README.md` — DTO 손 사본). 경계를 두면 대조는 검사가 해야 한다.

## 이 검사가 여기 있는 경위

예측 데모(`app/apis/demo_routers.py`)가 같은 일을 하고 있었다 —
`test_demo_form_field_names_exist_in_both_dtos` 가 데모 HTML 안의 `ML_NUM`·`RULE_NUM`
목록을 정규식으로 뽑아 두 DTO 와 대조했다. 데모를 판정 화면에 합치면서 그 화면이
사라졌고, 검사가 지키던 계약은 그대로 남아 대상만 `fields.ts` 로 옮겼다.

DB 가 필요 없으므로 `app/tests/model` 에 둔다 — 항상 먼저 도는 스위트다.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.dtos.assessment_summary import AssessmentSummaryRequest

FIELDS_TS = Path(__file__).resolve().parents[3] / "frontend" / "src" / "features" / "assessment" / "fields.ts"

#: 폼에 있지만 요청 본문으로 안 나가는 것. 지금은 없고, 생기면 여기에 이유를 적는다.
NOT_SENT: frozenset[str] = frozenset()


def form_field_names() -> set[str]:
    """`FIELD_GROUPS` 안의 `name:` 값을 뽑는다.

    `FIELD_GROUPS` 선언 블록만 본다 — 파일 전체를 훑으면 `FIELD_META`·`SELF_RATED`
    같은 다른 표의 키까지 섞인다.
    """
    source = FIELDS_TS.read_text(encoding="utf-8")
    start = source.index("export const FIELD_GROUPS")
    end = source.index("const NUMERIC_SELECTS", start)
    return set(re.findall(r'name:\s*"([a-z0-9_]+)"', source[start:end]))


def test_fields_ts_exists() -> None:
    """경로가 바뀌면 아래 검사가 조용히 빈 집합을 비교하게 된다."""
    assert FIELDS_TS.is_file(), f"{FIELDS_TS} 가 없다. 폼 정의가 옮겨졌으면 이 경로를 고쳐라"
    assert len(form_field_names()) > 20, "필드를 못 뽑았다. `FIELD_GROUPS` 표기가 바뀐 것으로 보인다"


def test_form_sends_only_fields_the_dto_accepts() -> None:
    """폼에만 있는 이름은 422 를 만든다."""
    declared = set(AssessmentSummaryRequest.model_fields)
    extra = form_field_names() - declared - NOT_SENT
    assert not extra, (
        f"판정 폼이 DTO 에 없는 필드를 보낸다: {sorted(extra)}. "
        "`AssessmentSummaryRequest` 는 extra='forbid' 라 이 요청은 422 가 된다"
    )


def test_every_dto_field_has_a_place_to_be_entered() -> None:
    """DTO 에만 있는 이름은 물어볼 자리가 없다는 뜻이다.

    유령 입력의 반대 방향이다. AGENTS.md 6번이 "DTO 필드를 더하면 그 값이 결과를
    바꿔야 한다" 고 적었는데, 결과를 바꾸는 필드를 **묻지 않는 것**도 같은 종류의
    손실이다 — `veg_fruit_daily`·`education_level` 을 뺄 때는 학습·번들·폼을 함께
    고쳤다. 한쪽만 고치면 여기가 잡는다.
    """
    declared = set(AssessmentSummaryRequest.model_fields)
    missing = declared - form_field_names()
    assert not missing, (
        f"DTO 에 있지만 폼이 묻지 않는 필드: {sorted(missing)}. "
        "묻지 않기로 정한 값이면 학습(`modeling/targets.py`)과 번들에서도 같이 빼고 DTO 에서 지워라"
    )
