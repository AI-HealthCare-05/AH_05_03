"""AI 지침서가 조용히 길어지거나 없는 경로를 가리키지 않게 막는다.

## 왜 이게 필요한가

2026-08-28 멘토링: **"AI 지침서는 짧게. 많아질수록 오히려 안 보니, AI 가 마음대로
늘리지 못하게 팀 승인 방식으로 관리하는 걸 추천."**

"짧게 쓰자" 는 규범만으로는 안 지켜진다. 지침서는 한 줄씩 늘고 아무도 그 한 줄을
막지 않으며, 어느 순간 아무도 안 읽는 문서가 된다. 그래서 **예산을 CI 로 강제한다.**
한도를 넘기면 빌드가 멈추고, 늘리려면 한도 자체를 고치는 커밋이 필요하다 —
그 커밋이 리뷰에 올라가는 것이 곧 "팀 승인" 이다.

경로 검사도 같은 이유다. AI 가 만든 지침서는 **있어 보이는 파일 경로를 지어낸다.**
그 경로를 따라간 사람은 문서 전체를 의심하게 된다.

    uv run python scripts/ci/check_agent_docs.py
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

#: 줄 수 한도. 넘기려면 이 숫자를 고치는 커밋이 필요하고, 그 리뷰가 승인 절차다.
#: 2026-09-03 기준 AGENTS.md 는 89줄이다. 여유를 조금만 둔다 — 여유가 크면 예산이 아니다.
BUDGETS: dict[str, int] = {
    "AGENTS.md": 110,
    "CLAUDE.md": 20,
}

#: 문서가 가리키는데 저장소에 없어도 되는 것. 자리표시자와 외부 링크다.
PLACEHOLDERS = ("NN", "000N", "*", "http")

#: `CLAUDE.md` 는 `AGENTS.md` 를 import 해야 한다. 두 벌로 갈라지면 도구마다
#: 다른 규칙을 읽게 되고, 그게 정확히 이 세팅이 막으려던 것이다.
REQUIRED_IMPORT = "@AGENTS.md"


def cited_paths(text: str) -> set[str]:
    """마크다운 링크와 백틱 경로에서 저장소 경로만 추린다."""
    links = set(re.findall(r"\]\(([^)#]+)\)", text))
    ticks = set(
        re.findall(r"`((?:app|modeling|frontend|docs|scripts|ai_worker|chronic_disease_engine)/[^`\s]+)`", text)
    )
    return {p for p in links | ticks if not any(token in p for token in PLACEHOLDERS)}


def check(name: str, limit: int) -> list[str]:
    path = ROOT / name
    if not path.is_file():
        return [f"{name}: 파일이 없다"]

    text = path.read_text(encoding="utf-8")
    problems: list[str] = []

    lines = len(text.splitlines())
    if lines > limit:
        problems.append(
            f"{name}: {lines}줄로 한도 {limit}줄을 넘었다. "
            f"줄이거나, 늘려야 할 이유를 리뷰에 적고 이 파일의 BUDGETS 를 고쳐라"
        )

    for cited in sorted(cited_paths(text)):
        target = (path.parent / cited).resolve()
        if not target.exists():
            problems.append(f"{name}: 가리키는 경로가 없다 — {cited}")

    return problems


def main() -> int:
    problems: list[str] = []
    for name, limit in BUDGETS.items():
        problems += check(name, limit)

    claude = ROOT / "CLAUDE.md"
    if claude.is_file() and REQUIRED_IMPORT not in claude.read_text(encoding="utf-8"):
        problems.append(f"CLAUDE.md: `{REQUIRED_IMPORT}` 가 없다. 규칙이 두 벌로 갈라진다")

    if problems:
        print("AI 지침서 점검 실패")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    for name, limit in BUDGETS.items():
        used = len((ROOT / name).read_text(encoding="utf-8").splitlines())
        print(f"  {name:<12} {used:>4} / {limit} 줄")
    print("AI 지침서 점검 통과")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
