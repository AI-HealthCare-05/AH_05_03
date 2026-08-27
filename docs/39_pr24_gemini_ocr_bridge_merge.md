# 39. PR #24 Gemini OCR 브리지 — 로컬 반영 기록

> 작성일: 2026-08-26
> 원본: [AI-HealthCare-05/AH_05_03 PR #24](https://github.com/AI-HealthCare-05/AH_05_03/pull/24) `feature/gemini-ocr-only` → `dev`, 작성자 dungdada
> 반영 위치: 로컬 작업 브랜치 `feat/ML_enhance` (미커밋 작업 트리)
> 성격: **머지가 아니라 파일 단위 이식 기록.** 원 PR 은 아직 열려 있다.

## 0. 왜 머지하지 않았나


작업 트리에 미커밋 변경이 **108개** 있었다. 그 위에 `git merge` 를 걸면 되돌릴 방법이 마땅치 않아서, PR 브랜치를 `fetch` 만 하고 **파일을 골라 넣은 뒤 겹치는 것만 손으로 합쳤다.**

원 PR 은 그대로 열려 있고, 나중에 `dev` 로 머지되면 이 이식분과 만난다. 겹치는 다섯 파일은 전부 순수 추가라 충돌 나도 사소하다.

## 1. 무엇이 들어왔나


PR 은 15파일 +407 −170. 로컬에 **하나도 없던** 상태였다.

### 새로 생긴 파일 다섯

| 파일 | 줄 | 내용 |
|---|---:|---|
| `app/services/dev_ocr.py` | 126 | Gemini API 로 이미지·PDF 를 구조화하는 프록시 |
| `app/apis/v1/dev_ocr_routers.py` | 31 | `POST /api/v1/dev/ocr/recognize` |
| `app/dtos/ocr.py` | 13 | `RawOcrData` |
| `app/tests/services/test_dev_ocr.py` | 67 | 서비스 검사 |
| `frontend/src/shared/api/geminiOcrAdapter.ts` | 32 | 브라우저 어댑터 |

### 손으로 합친 파일 일곱

전부 **순수 추가**라 내 챌린지 변경과 부딪히지 않았다.

| 파일 | 더한 것 |
|---|---|
| `app/apis/v1/__init__.py` | `dev_ocr_router` 임포트·등록 (챌린지 라우터 아래) |
| `app/core/errors.py` | `OCR_UNAVAILABLE` (코드·503 매핑·기본 문구) |
| `app/exceptions.py` | `OcrUnavailableError` |
| `app/core/config.py` | `ENABLE_DEV_OCR_BRIDGE` · `DEV_OCR_MAX_FILE_BYTES` · `GEMINI_API_KEY` |
| `docker-compose.yml` | fastapi 환경변수 둘 |
| `envs/example.local.env` | 같은 셋의 예시 |
| `pyproject.toml` | `google-genai>=2.19.0` |

프런트 둘(`DataManagementPage.tsx` · `browserOcrAdapter.ts`)은 로컬 변경이 없어 PR 버전을 그대로 받았다.

## 2. 이식하면서 걸린 것 — 스택이 죽었다


`./app` 이 볼륨 마운트라 새 코드는 곧바로 컨테이너에 들어갔다. 그런데 **이미지에는 `google-genai` 가 없다.**

```
fastapi  |   File "/app/app/services/dev_ocr.py", line 5, in <module>
fastapi  |     from google import genai
fastapi  | ModuleNotFoundError: No module named 'google'
```

`from google import genai` 가 모듈 최상단이고 라우터가 그것을 임포트하므로 **앱 전체가 안 뜬다.** fastapi 가 `unhealthy` 가 되고 `/api/health` 가 504 였다. 이미지를 다시 빌드해 복구했다.

**옮겨 적어 둘 만한 사실.** 파이썬 소스만 마운트되는 구성에서는 새 의존성이 붙는 순간 재빌드가 필수다. 코드만 넣고 `up -d` 만 하면 스택이 조용히 죽는다.

### `uv sync` 함정도 한 번 밟았다

`uv sync --group app --no-dev` 로 잠금을 반영했더니 **venv 에서 ruff·mypy·pytest 가 걷혔다.** `uv sync --all-groups` 로 되돌렸다. 정적 검사·테스트는 `uv run --no-sync` 로 돌려야 한다.

## 3. 이식 직후 검증


| 항목 | 결과 |
|---|---|
| 스택 | fastapi `healthy` 복구, 나머지 정상 |
| 엔드포인트 | `/api/v1/dev/ocr/recognize` 등록. 전체 30개, 챌린지 6개 그대로 |
| 브리지 기본 상태 | `ENABLE_DEV_OCR_BRIDGE=false` — 실제 파일을 올리면 `OCR_UNAVAILABLE` 봉투를 낸다 |
| 서비스 테스트 (컨테이너) | **35건 통과** (PR 의 `test_dev_ocr.py` 포함) |
| 프런트 전체 | **85건 통과** |
| `tsc` · `eslint` | 통과 |
| 경로 | `/api/health` · `/challenge` · `/challenge/today` · `/data` 전부 200 |

## 4. 실제로 돌아가게 고친 것 여섯


이식만 해서는 이 프로젝트에서 안 돌아간다. 배선 문제 넷과 코드 품질 둘을 고쳤다.

### 4-1. 절대 주소가 박혀 있었다 (가장 큰 것)

```ts
constructor(private readonly baseUrl = "http://127.0.0.1:8000/api/v1")
```

세 가지가 한꺼번에 틀어진다.

- **nginx 를 건너뛴다.** 나머지 화면은 전부 상대 경로 `/api/v1` 로 nginx 를 통한다
- **교차 출처가 된다.** 화면은 `http://localhost` 인데 요청은 `http://127.0.0.1:8000` — 다른 오리진이라 CORS 에 걸린다
- **배포에서 죽는다.** `docker-compose.yml` 이 `127.0.0.1:8000` 으로 루프백에만 묶어 뒀다("nginx 를 건너뛰고 직접 때려 보려고 남기되")

어댑터가 자체 `fetch` 를 버리고 `serverApiClient` 를 타게 했다. 상대 경로·인증 헤더·토큰 갱신·오류 봉투를 전부 공짜로 얻는다.

### 4-2. `serverApiClient` 가 FormData 를 깨뜨렸다

```ts
if (requestInit.body !== undefined) headers.set("Content-Type", "application/json");
```

`FormData` 에 이 헤더를 씌우면 브라우저가 붙이는 multipart boundary 가 사라진다. 서버가 `Missing boundary in multipart` 를 낸다 — 실제로 재현했다. **문자열 본문일 때만** JSON 으로 선언하도록 바꿨다.

파일 업로드 경로가 이 클라이언트를 처음 타면서 드러난 잠복 버그다.

### 4-3. 인증도 상한도 없었다

`/api/v1/dev/ocr/recognize` 가 열려 있었다. 다른 v1 라우트는 전부 `require_active_account` 를 지나는데 여기만 빠져 있었고, **외부 유료 API 를 부르는 경로**라 더 나쁘다.

`require_active_account` 와 계정별 레이트리밋(`DEV_OCR_RATE_LIMIT` 분당 20)을 붙였다. 인증이 없으면 상한을 걸 대상도 없으므로 둘은 같이 가야 한다.

### 4-4. 모델 목록에 현재 GA 모델이 없었다

PR 은 `gemini-3.6-flash` · `gemini-3.5-flash` 만 시도한다. 공식 문서 확인 결과 **현재 GA 는 `gemini-3.7-flash`** 다. 맨 앞에 더했다 — 뒤의 둘만 두면 그 세대가 내려갔을 때 경로 전체가 죽는다. 둘은 과부하·지연 대비 fallback 으로 남겼다.

### 4-5. 린트·타입

| | 어떻게 |
|---|---|
| `C901` 복잡도 21 | `_resolve_mime_type` · `_to_part` · `_generate` 로 쪼개고 프롬프트를 `_PROMPT` 상수로. **로직은 그대로** — MIME 판별 4케이스를 대조해 확인했다 |
| `F401` 안 쓰는 `import sys` | 삭제 |
| mypy `arg-type` | `[*parts, _PROMPT]` 가 `list[object]` 로 추론된다. SDK 가 내보내는 `types.PartUnionDict` 로 명시 |

### 4-6. 브리지를 켰다

`.env` 에 `ENABLE_DEV_OCR_BRIDGE=true` 를 넣었다. `.env` 는 `.gitignore` 에 있어 키가 커밋되지 않는다.

### 검증

| 검사 | 결과 |
|---|---|
| 인증 없이 호출 | **401 `AUTH_REQUIRED`** |
| 인증 후, 키 없음 | **503 `OCR_UNAVAILABLE`** — "Gemini API 키가 설정되지 않았습니다." |
| 25연타 (상한 20) | 429 가 7건 |
| 백엔드 (컨테이너) | 서비스 + 봉투 계약 **42건 통과** |
| 프런트 | **85건 통과** |
| `ruff` · `mypy` · `tsc` · `eslint` | 전부 통과 |

**남은 것은 API 키 하나뿐이다.** 키를 넣으면 실제 인식까지 돈다.

## 5. PR 자체에 남아 있던 문제 둘 — §4 에서 고쳤다


남의 PR 코드라 고치지 않았다. 원 PR 리뷰에서 나올 것들이다.

| 항목 | 위치 |
|---|---|
| `C901` `recognize` 복잡도 21 (상한 10) | `app/services/dev_ocr.py:27` |
| `F401` 안 쓰는 `import sys` | `app/tests/services/test_dev_ocr.py:1` |

**지금 `ruff check app/` 이 이 둘로 실패한다.** 이식 전에는 통과하던 상태였다.

## 6. 결정이 필요한 것 — 외부 LLM API 예외 ADR


[36번 §6](36_feature_scope_vs_talos_requirements.md) 이 이미 적어 둔 항목이다.

> ADR-008 은 Naver CLOVA 를 **콕 집어** 허용했지 일반 외부 LLM API 를 다루지 않는다. 같은 형식의 예외 ADR 이 필요하다.

Gemini 는 그 "일반 외부 LLM API" 에 해당한다. 그리고 [ADR-010 §2](adr/0010-checkup-document-ocr-path.md) 는 멀티모달 직송을 **기본 엔진에서 기각**했다 — 근거 좌표(bounding box)를 잃어서 30개 항목 중 하나가 틀렸을 때 사용자가 찾을 방법이 사라진다는 이유였다.

PR 은 그 결정을 뒤집는 것이 아니라 **개발·시연용 브리지**로 이름 붙였고 기본값도 꺼 두었다(`ENABLE_DEV_OCR_BRIDGE: bool = False`). 그 선택은 ADR 과 충돌하지 않는다. 다만 켜서 시연에 쓰기로 하면 그때는 예외 ADR 이 선행이다.

**서비스 docstring 이 그 경계를 스스로 적어 두었다** — "디스크(DB, File System)나 로그에 원본 이미지나 결과를 남기지 않고 메모리 상에서 처리한다. 추후 브라우저 로컬 모델로 교체 시 이 서비스는 제거된다."


---
