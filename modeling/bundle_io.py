"""번들을 덮어쓸 때 잃으면 안 되는 필드를 지켜 주는 자리.

## 왜 필요한가

`rule_anchor` 는 학습 산출물이 아니라 **사후 주입물**이다. `engine_agreement.py` 가
번들의 확률을 규칙 엔진 판정과 맞춰 본 뒤 `--write-bundles` 로 써 넣는다. 그런데
export 스크립트들은 매번 번들을 처음부터 만들어 그대로 덮어쓰므로, 재export 한 번에
앵커가 조용히 사라진다.

실제로 그렇게 사라져 있었다 — 앵커 산출 2026-08-21 16:07, 번들 재export 2026-08-25 13:05.
그 사이 `interpret()` 은 계속 `None` 을 돌려줬고, 화면의 "이 확률대의 사람 100명 중
몇 명이 학회 기준을 넘는가" 는 **한 번도 뜨지 않았다.** 로그도 오류도 남지 않는다 —
없는 게 정상 동작처럼 보이는 종류의 결손이라 이렇게 코드로 막는다.

## 왜 앵커를 새로 만들지 않고 옮겨 담는가

앵커를 만들려면 NHANES 원본과 규칙 엔진이 필요해서 export 경로에서는 부담이 크다.
대신 **모델이 바뀌면 앵커도 다시 계산해야 한다** — 확률 분포가 달라지면 구간 경계가
어긋난다. 그래서 옮겨 담되, 다시 돌려야 한다는 사실을 export 로그에 남긴다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

#: 새 번들에는 없지만 기존 파일에 있으면 살려야 하는 키.
CARRIED_OVER = ("rule_anchor",)


def carry_over(path: Path, bundle: dict[str, Any]) -> list[str]:
    """`path` 에 이미 있는 번들에서 사후 주입 필드를 `bundle` 로 옮긴다.

    옮긴 키 목록을 돌려준다 — 호출부가 로그에 남길 수 있게.
    파일이 없거나 깨졌으면 아무것도 하지 않는다(첫 export 가 정상 경로다).
    """
    if not path.exists():
        return []
    try:
        previous = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(previous, dict):
        return []

    moved = []
    for key in CARRIED_OVER:
        value = previous.get(key)
        if value:
            bundle[key] = value
            moved.append(key)
    return moved


def note(moved: list[str]) -> str:
    """export 로그 꼬리표. 옮긴 게 없으면 빈 문자열."""
    if not moved:
        return ""
    return f"  (이전 번들에서 {', '.join(moved)} 승계 — 모델이 바뀌었으면 engine_agreement.py 를 다시 돌려라)"
