# 40. 문서 인식 큐 — nginx → FastAPI → Redis → ai-worker

> 작성일: 2026-08-26
> 선행: [39 PR #24 이식 기록](39_pr24_gemini_ocr_bridge_merge.md) · [ADR-010 §6](adr/0010-checkup-document-ocr-path.md)
> 참고 구조: 예측 큐 ([35번](35_prediction_queue_and_workers.md))

PR #24 는 요청 수명 안에서 Gemini 를 부르는 동기 프록시였다. 이 문서는 그것을 기존
예측 큐와 같은 비동기 구조로 옮긴 기록이다.

## 0. 흐름

```
브라우저 ── nginx ── FastAPI ──┬─→ Redis Stream (ieobom:ocr:stream)
   ↑                          │        │
   │                          │        ↓
   └── GET /jobs/{id} 폴링 ────┘   ai-worker (OcrConsumer)
                                        │
                                        ├─→ Gemini API
                                        └─→ 결과를 job 해시에 되쓰기
```

## 1. 왜 큐로 옮겼나

**Gemini 왕복이 실측 7~20초다.** 동기로 매달면 nginx 타임아웃과 사용자 대기가 함께 늘고,
워커 3대를 띄워도 병렬화가 안 된다. 예측 축이 같은 이유로 이미 큐를 쓴다.

## 2. 만든 것

| 파일 | 내용 |
|---|---|
| `app/core/jobs/ocr_contract.py` | 큐 계약 — 키·상태·필드. FastAPI 와 워커가 같이 읽는 유일한 정의 |
| `app/core/jobs/ocr_store.py` | `OcrJobStore` — 등록·조회·회수·완료 |
| `ai_worker/ocr_consumer.py` | `OcrConsumer` — 스트림 소비, Gemini 호출, 결과 되쓰기 |
| `app/apis/v1/dev_ocr_routers.py` | `POST /jobs` (202) · `GET /jobs/{id}` · `POST /recognize` (동기) |
| `frontend/.../geminiOcrAdapter.ts` | 등록 후 폴링 |

### 키 공간을 갈랐다

`ieobom:ocr:stream` · `ieobom:ocr:job:{id}` · 그룹 `ocr-workers`. 예측 큐와 한 스트림을
쓰면 소비자가 자기 것이 아닌 메시지를 집어 `XACK` 없이 버린다.

### 워커는 소비자 둘을 함께 돌린다

`asyncio.gather` 로 `PredictionConsumer` 와 `OcrConsumer` 를 같이 띄우되 **Redis 연결을
둘로 나눴다.** 하나를 공유하면 한쪽의 `XREADGROUP` 이 block 하는 동안 다른 쪽 명령이
줄을 선다 — 문서 인식은 왕복이 수십 초라 예측 큐가 그만큼 멈춘다.

## 3. 예측 큐와 다르게 잡은 값 넷

원본 이미지가 흐르는 큐라 상한을 더 좁게 잡았다.

| 값 | 예측 | 문서 인식 | 이유 |
|---|---:|---:|---|
| `TTL` | 600s | **300s** | 원본이 Redis 에 머무는 시간을 줄인다 |
| `RECLAIM_IDLE` | 60s | **180s** | Gemini 왕복이 길다. 짧으면 정상 처리 중인 작업을 다른 워커가 뺏어 가 같은 문서를 두 번 보낸다 |
| `MAX_ATTEMPTS` | 3 | **2** | 외부 유료 API 라 재시도가 곧 비용 |
| `BATCH` | 10 | **2** | 한 작업이 이미지 여러 장을 물어 메모리를 크게 쓴다 |

원본은 base64 로 job 해시에 싣는다. FastAPI·워커의 Redis 연결이 둘 다
`decode_responses=True` 라 바이너리를 그대로 넣으면 읽는 쪽이 디코딩에 실패한다.
33% 크기 손해를 받아들이고 예측 큐와 같은 배선을 쓰되 `DEV_OCR_JOB_MAX_TOTAL_BYTES`
(30MB)로 한 작업의 총합을 묶었다.

## 4. 고치면서 잡은 것 셋

### 4-1. 타임아웃이 없어 큐가 통째로 멎었다

첫 판을 돌리자 작업이 `running` 에서 멈추고 **뒤이은 작업이 전부 `queued` 로 쌓였다.**
`asyncio.to_thread(generate_content)` 에 타임아웃이 없어 소비자 루프가 영구히 물린 것이다.
SDK 는 자체 재시도를 하고 응답이 안 오면 무한정 매달린다.

`asyncio.wait_for` 로 감쌌다(`DEV_OCR_CALL_TIMEOUT_SECONDS` 45초). **큐에서 외부 호출에
타임아웃이 없으면 한 건이 전체를 막는다** — 동기 경로에서는 요청 하나만 죽지만 큐에서는
증상이 다르다.

`to_thread` 는 취소해도 스레드를 죽이지 못한다. 그 스레드는 남지만 소비자 루프는
풀려나 다음 작업으로 간다.

### 4-2. 모델 순서를 문서가 아니라 실측으로 정했다

공식 문서상 현재 GA 는 `gemini-3.7-flash` 라 맨 앞에 뒀는데, **이 저장소의 키로는
`generateContent` 가 응답하지 않는다.**

```
v1beta  gemini-3.7-flash   40.1s  TimeoutError
v1beta  gemini-3.5-flash   13.2s  200 OK
v1      gemini-3.7-flash   40.1s  TimeoutError
v1      gemini-3.5-flash    7.4s  200 OK
v1beta  gemini-2.5-flash    0.2s  404  "no longer available to new users"
```

**`models.list` 에는 셋 다 보인다.** 목록에 있다는 것과 호출이 된다는 것이 다르다.
확인된 것을 앞에 두고 새 세대를 뒤에 남겼다 — 권한이 열리면 다시 재서 순서를 올린다.

> **[2026-08-27 정정] 위 "TimeoutError" 는 오진이었다.**
>
> 45초 래퍼를 걷고 다시 재 보니 `gemini-3.7-flash` 는 응답하지 않는 모델이 아니라
> **무료 등급 할당량에 막히는 모델**이다. 두 단계로 드러났다.
>
> ```
> 1차 (SDK 기본 재시도 5회)   48~56s  3회 중 2회 성공 · 1회 503 UNAVAILABLE
> 2차 (attempts=1 로 재시도 차단)  102s · 1200s  둘 다 503 "Deadline expired"
> 3차 (할당량 소진 후)          0.7s  429 RESOURCE_EXHAUSTED
> ```
>
> 마지막 응답에 원인이 그대로 적혀 있다.
>
> ```
> Quota exceeded for metric: generate_content_free_tier_requests,
> limit: 20, model: gemini-3.7-flash
> ```
>
> **무료 등급에서 3.7 은 하루 20건**이다. 시연 한 번에 소진되는 양이라 제품 기본으로
> 쓸 수 없다. 앞선 40초 타임아웃은 무료 등급 혼잡(503)을 우리 래퍼가 자른 것이었다.
>
> 여기서 배울 것이 하나 더 있다. **`attempts=1` 로도 지연이 안 잡혔다** — 오래
> 걸리는 것이 클라이언트 재시도가 아니라 서버가 연결을 붙잡는 시간이라, 끊는 쪽은
> 우리여야 한다. 실제 방어선은 `_stream_once` 의 `asyncio.wait_for` 다.
>
> 스트리밍으로 다시 잰 값(같은 이미지·같은 스키마)은 이렇다.
>
> ```
> gemini-3.6-flash   첫 청크  6.0s   총  7.7s   18청크   ← 기본값
> gemini-3.5-flash   첫 청크 18.9s   총 20.3s   18청크
> gemini-3.7-flash   할당량 소진 시 0.7s 429, 혼잡 시 첫 청크 없음
> ```
>
> 순서는 이제 코드가 아니라 `DEV_OCR_MODELS`(JSON 배열)가 정한다. 유료 등급으로
> 올려 3.7 을 앞에 두려면 `.env` 한 줄이면 되고, compose 의 `environment:` 가
> fastapi·ai-worker 양쪽에 같은 값을 넘긴다.

### 4-3. 진단 중에 헛다리를 두 번 짚었다

옮겨 적어 둘 만하다.

- `docker compose exec ai-worker python` 은 **시스템 python** 을 쓴다. 컨테이너는
  `uv run` 으로 venv 를 태우므로 `ModuleNotFoundError` 가 나온다. `uv run --no-sync` 를 붙여야 한다
- Git Bash 가 `/app/.venv/bin/python` 을 Windows 경로로 바꾼다. `MSYS_NO_PATHCONV=1` 필요

## 5. 동기 경로를 남긴 이유

`POST /dev/ocr/recognize` 를 지우지 않았다. 예측 축이 `/predictions/risk`(동기)와
`/predictions/jobs`(비동기)를 함께 두고 **둘의 결과가 바이트 단위로 같음**을 근거로
쓰는 것과 같은 구성이다(36번 §1-2).

두 경로가 같은 `recognize_parts` 를 부르므로 갈릴 수 없다. `DevOcrService.recognize` 는
검증만 하고 그 함수로 넘긴다.

## 6. 실측

실제 검진 결과지(`sample.jpeg`)로 전 구간을 태웠다.

| 단계 | 결과 |
|---|---|
| `POST /dev/ocr/jobs` | **202** · `job_id` 반환 |
| 워커 픽업 | 2초 안에 `running` |
| 완료 | **20초** · `succeeded` · attempts=1 |
| 결과 | 표 1개 · 텍스트 290자 · HDL 50 / LDL 167 / 중성지방 추출 |
| 인증 없이 등록 | **401 `AUTH_REQUIRED`** |
| 상한 초과 | 429 (분당 20) |

### ADR-010 §6 네 조건

| 조건 | 확인 |
|---|---|
| 완료 시 원본 즉시 삭제 | `hkeys` 에 **`payload` 없음** (attempts·status·result 등만) |
| TTL | **273초** 남음 (300초에서 감소 중) |
| 키에 계정 식별자 없음 | `ieobom:ocr:job:{무작위 32자}` |
| 로그에 본문 없음 | `job=… 완료 · 표 1개 · 18283ms · attempts=1` — 파일명·수치·결과 없음 |
| 지속화 끔 | `save` 빈 값 · `appendonly no` |

### 회수 동작

워커를 재시작하자 로그에 `죽은 소비자 몫 1건 회수` — `XAUTOCLAIM` 이 실제로 돈다.

### 회귀

| | |
|---|---|
| 백엔드 | 225 통과 / 5 실패 |
| 프런트 | 85 통과 |
| `ruff` · `mypy` · `tsc` · `eslint` | 통과 |

**실패 5건은 38번 §10-1 에 적은 환경 의존 건 그대로다** — 로그인 쿠키 1건(compose 가
`REFRESH_COOKIE_SECURE=false`)과 예측 4건(`/app/modeling` 미마운트). 이번 변경과 무관하다.

## 7. 남은 것

| | 항목 |
|---|---|
| 1 | **큐 계약 테스트.** 예측 큐에는 `test_job_contract.py` 가 ADR 조건을 검사한다. 문서 인식 큐에는 아직 없다 |
| 2 | **`gemini-3.7-flash` 재확인.** 키·프로젝트 권한이 바뀌면 다시 재서 순서를 올린다 |
| 3 | **외부 LLM API 예외 ADR.** 39번 §6 참조. 시연에 쓰기로 하면 선행이다 |
| 4 | **`ocr_store.py` 와 `store.py` 의 중복.** 의도적으로 복사했지만(파일 머리말 참조) 한쪽만 고치는 사고가 날 수 있다 |
