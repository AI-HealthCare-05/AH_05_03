# AGENTS.md

이 저장소에서 AI 도구(Claude Code · Codex · Cursor)가 지키는 규칙. **정본은 [34번 규칙 문서](docs/34_project_rules_and_workflow.md) 와 [ADR](docs/adr/README.md) 이고 이 파일은 요약이다.** 어긋나면 정본이 이긴다.

> **이 파일은 짧게 유지한다.** 길어지면 아무도 안 읽는다. 항목을 더하려면 팀 승인을 받고, 정본(34번·ADR)에 먼저 적은 뒤 한 줄로 옮긴다. AI 가 스스로 늘리지 않는다.

## 작업 위치

저장소 루트는 이 폴더(`project/`)다. 파이썬은 `.venv/Scripts/python.exe` 또는 `uv run --no-sync`, 프런트는 `frontend/` 에서 `npm`. 스택은 `docker compose`(redis·postgres·fastapi·nginx) + `--profile ai` 워커 3대.

## 착수 전에 읽는다

[34번 규칙 문서](docs/34_project_rules_and_workflow.md) · [ADR 인덱스](docs/adr/README.md)(**`제안` 상태를 확정으로 인용하지 않는다**) · 건드리는 영역의 짝 문서.

| 영역 | 문서 |
|---|---|
| ML·서빙 | 19 · 21 · 23 · 27 · 30 · 41 · 42 · ADR-009 |
| 판정 중재 | 22 · 31 · `app/services/assessment.py` 머리말 |
| 챗봇·RAG | **43** |
| OCR·저장 | 24 · 40 · **44** · ADR-010 |
| 프런트 | `frontend/README.md` · `features/assessment/contracts.ts`(서버 DTO 손 사본) |

## 어기면 조용히 틀리는 것

1. **`chronic_disease_engine/` 무수정.** 팀원 PR 을 그대로 가져온 비교 기준이다. 확장은 밖에 붙인다.
2. **`[project] dependencies` 에 서빙이 import 안 하는 패키지를 넣지 않는다.** `--no-dev` 로도 안 빠져 런타임 이미지에 들어간다.
3. **서빙은 sklearn·numpy 의존 0.** JSON 번들 + 순수 파이썬 채점. 학습→서빙 import 는 되지만 반대는 안 된다.
4. **라벨 누출 차단의 단일 진실 원천은 `modeling/targets.py`.**
5. **같은 판단을 두 곳에 복사하지 않는다.** 동기·큐 경로는 `prediction.build_prediction` 하나, 단조 방향은 `train_multi.monotone_direction` 하나. 복사본은 한쪽만 고쳐지고 테스트는 통과한다.
6. **DTO 필드를 더하면 그 값이 결과를 바꿔야 한다**(유령 입력 금지).
7. **`spa.mount(app)` 은 `main.py` 맨 마지막.** catch-all 이다.
8. **번들 재export 는 사후 주입물을 지운다.** `rule_anchor` 는 `bundle_io`, `trajectory.json` 의 `evidence` 는 `fit_trajectory` 가 승계한다.
9. **`.env`·`*.pem`·`*.key` 는 열지도 출력하지도 않는다.** 키 이름 유무만 `grep -c` 로 본다.
10. **`git checkout -- .` 을 쓰지 않는다.** 되돌릴 것만 경로로 지정한다. 2026-09-03 에 이것 하나로 그날 작업 전체가 날아갔다.

## 검증 — 같은 순서로, 숫자로

```bash
uv run ruff check . && uv run ruff format . --check
uv run mypy app
uv run python -m pytest app/tests/model -q     # DB 불필요. 항상 먼저
uv run python -m pytest app/tests -q           # PostgreSQL 필요
uv run alembic check
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
```

커밋 훅은 `uv run pre-commit install` 로 한 번 건다(ruff·yaml·큰 파일만. 느린 것은 CI).

모델·데이터를 바꿨으면 추가로 — 라벨 차단 집합 그대로인가 · 학습과 서빙이 같은 특징인가 · 보정(ECE)을 AUROC 와 **함께** 적었나 · 방향 계약 · 번들 크기.

### 실행 중 스택에 반영

| 바꾼 것 | 반영 |
|---|---|
| `app/`·`ai_worker/` 파이썬 | `docker compose restart fastapi` · `--profile ai restart ai-worker` |
| `frontend/` | `docker compose build fastapi && docker compose up -d fastapi` |
| `artifacts/models/*.json` | 자동(mtime 감시) |
| fastapi **재생성** 후 | `docker compose restart nginx` (IP 바뀜 → 502) |

배포 점검은 `GET /api/v1/predictions/model-info` 하나면 된다 — 번들 20개와 궤적 표 적재 여부를 같이 말한다.

## 이미 밟은 함정

- pytest 가 출력 없이 멈춘다 → `localhost` 가 `::1` 로 풀린 것. `127.0.0.1` 로.
- fastapi `Restarting (255)` → 대개 alembic. 마이그레이션은 `app/core/db/migrations/versions`, DB 는 `ai_health`.
- 테스트 DB 는 체크아웃 사이에 공유된다. traceback 경로가 내 작업 디렉터리가 아니면 이것이다.
- 스위트 도는 중에 소스를 고치지 않는다. 백그라운드 pytest 는 파이프 말고 파일로 리다이렉트.
- 한글·`—` 를 print 하는 스크립트는 `PYTHONIOENCODING=utf-8` 을 붙인다(cp949).
- "기여가 없다" 는 기록을 믿기 전에 그 변수가 홀드아웃 주기에 있는지부터 본다.
- 표본을 늘려도 AUROC 는 안 움직인다. 병목은 정보량이다.
- 합성 증강(SMOTE)은 8칸 전부 손해였다. 다시 하지 않는다.
- 지질 하위유형 3장은 "위험" 프레임으로 띄우지 않는다(사망연계 C 0.5~0.58).

## 문서·브랜치·커밋

`docs/NN_snake_case.md` 두 자리 순차(**다음 번호는 `git ls-tree origin/dev docs/` 로 원격 확인**, 현재 44). ADR 은 `docs/adr/000N-*.md` + 인덱스 상태 칸.
브랜치는 `feat/`·`fix/`·`docs/`·`chore/` 넷, 기준은 `dev`. 커밋은 `타입(범위): 요약`, **한 커밋에 한 변경**, 메시지에 측정값. 번들 재학습은 별도 커밋. **커밋·푸시는 사용자가 시킬 때만.**

## 착수 프롬프트 템플릿

```
목표: (한 줄)
채우는 칸: 입력 → 처리 → 출력 → 실패 처리 중 어디 (32번 표)
읽은 계약: 34번 · ADR-NNN · 짝 문서
바꿀 파일과 테스트:
되돌리는 방법: (없으면 착수하지 않는다)
```

끝낼 때 검증 결과와 **바뀐 숫자**(전/후)를 적는다. "예상된다" 는 증거가 아니다. AI 가 "했다" 고 한 것은 저장소 실물과 대조한다.
