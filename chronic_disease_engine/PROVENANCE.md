# 출처

이 디렉터리는 **직접 작성한 코드가 아니다.**

| 항목 | 내용 |
|---|---|
| 출처 | `AI-HealthCare-05/AH_05_03` PR #4 — `feat: add chronic disease risk engine` |
| 작성자 | ts04042-cell |
| 커밋 | `c6943b14` |
| 브랜치 | `issue-3-chronic-disease-engine` → `dev` |
| 가져온 시점 | 2026-08-20 |
| 변경 | 없음. 파일을 그대로 가져왔다 |

## 왜 그대로 두는가

내 ML 모델과 비교하기 위해 가져왔다. 한 글자라도 고치면 "팀원의 엔진과 비교"가 아니라
"내가 고친 엔진과 비교"가 된다. 개선이 필요하면 원 PR에 코멘트로 남기고, 여기서는 손대지 않는다.

PR이 갱신되면 다시 가져온다.

```bash
gh pr view 4 --repo AI-HealthCare-05/AH_05_03 --json commits --jq '.commits[-1].oid'
gh pr view 4 --repo AI-HealthCare-05/AH_05_03 --json files --jq '.files[].path'

# raw 헤더로 받는다. `--jq .content | base64 -d`는 Git Bash에서 깨진다.
gh api "repos/AI-HealthCare-05/AH_05_03/contents/chronic_disease_engine/<file>?ref=<oid>" \
  -H "Accept: application/vnd.github.raw" > chronic_disease_engine/<file>
```

다시 가져오면 아래 표와 `test_vendored_engine_is_unmodified`의 체크섬을 함께 갱신한다.
갱신 없이 통과하면 그 테스트는 아무것도 지키지 않는다.

## 체크섬

2026-08-20 커밋 `c6943b14` 원본과 **바이트 단위로 동일**함을 확인했다 (SHA-256, 줄바꿈 포함).

| 파일 | 크기 | SHA-256 (앞 16자) |
|---|---|---|
| `__init__.py` | 300 B | `fb9c4539b4a5fbd1` |
| `engine.py` | 2,380 B | `f496b43d4fdae7e0` |
| `schemas.py` | 5,403 B | `311d21a40bdc3abd` |
| `rules/__init__.py` | 296 B | `1c2fa55a32fda962` |
| `rules/diabetes.py` | 6,863 B | `5346f76f91c1a972` |
| `rules/dyslipidemia.py` | 12,650 B | `447af0c508feb011` |
| `rules/hypertension.py` | 5,562 B | `439b6bf406736e4d` |
| `rules/obesity.py` | 6,072 B | `b0f7e5931b61f4b9` |

린터도 이 디렉터리를 건드리지 않는다 — `pyproject.toml`의 `tool.ruff.extend-exclude`와
`tool.mypy.exclude`에 등록해 두었다. `ruff format`이 조용히 따옴표를 바꾸는 것만으로도
위 체크섬이 깨진다.

## 내 모델과 무엇이 다른가

| | 규칙 엔진 (PR #4) | ML 모델 (`modeling/`) |
|---|---|---|
| 방식 | 국내 학회 가이드라인 임계값 | NHANES 로지스틱 회귀 |
| 근거 | 대한고혈압학회·대한비만학회·대한당뇨병학회·한국지질동맥경화학회 | 미국 NHANES 4개 주기 25,457명 |
| 출력 | 5단계 등급 (INSUFFICIENT_DATA/NORMAL/CAUTION/HIGH/VERY_HIGH) | 0~1 확률 + 동년배 백분위 |
| 영역 | 고혈압·비만·이상지질혈증·당뇨 4개 | 당뇨·고혈압 2개 |
| 필요 입력 | 검사값 중심 (혈압·혈당·지질) | 생활습관 중심 (나이·성별·BMI·주관적 건강) |
| 검사값 없으면 | `INSUFFICIENT_DATA` | 중앙값 대치 후 확률 산출 |
| 한국인 기준 | **예** | 아니오 (미보정) |

**두 방식은 경쟁이 아니라 보완이다.** 검사값이 있으면 규칙 엔진이 국내 기준으로 정확히
판정하고, 검사값이 없으면 ML 모델이 생활습관만으로 선별한다.
