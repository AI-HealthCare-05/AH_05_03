# 35. 예측 작업 큐와 ai-worker

> 작성일: 2026-08-25
> 구현: `app/core/jobs/*` · `app/apis/v1/prediction_job_routers.py` · `ai_worker/consumer.py` · `docker-compose.yml`
> 계약 검사: `app/tests/model/test_job_contract.py`
> 관련 결정: [ADR-009](adr/0009-per-disease-models-and-server-inference-path.md) §7 실행 경로 · [ADR-010](adr/0010-checkup-document-ocr-path.md) §6 Redis payload 조건

## 0. 네 줄

1. **Redis 가 두 역할을 겸한다.** 리프레시 토큰 저장소(`ieobom:rt:*`)와 예측 작업 큐(`ieobom:predict:*`)다. 키 공간이 겹치지 않고, 건강 수치가 통과하므로 **지속화를 껐다.**
2. **워커 3 대가 중복 없이 나눠 처리한다.** 30 건을 던지니 11 / 10 / 9 로 갈렸고 재시도 0 건이었다. 코드에 분배 로직이 없다 — Redis 소비자 그룹이 한 메시지를 한 소비자에게만 배달한다.
3. **동기 경로와 비동기 경로의 결과가 바이트 단위로 같다.** 12,410 바이트가 완전히 일치했다. 채점 함수를 하나로 뽑아 두 경로가 공유하게 만든 결과다.
4. **이건 ADR-009 §7 을 뒤집는 게 아니다.** 예측은 여전히 동기가 기본이다. 큐 경로는 워커 구조를 실제로 세워 재고 배우기 위해 나란히 둔 것이고, 무엇을 화면에 쓸지는 §7 의 실측으로 정한다.

---

## 1. ADR-009 §7 과의 관계 — 뒤집지 않는다

§7 은 예측을 동기로 정했다. 근거는 채점이 순수 파이썬이라 큐를 태우면 직렬화와 폴링 왕복이 본 작업보다 커진다는 것이었고, **그 판단은 지금도 맞다.** 다만 §7 에 인용한 `1.3 ms` 는 번들 하나 기준이었다 — 질환 10 건을 담는 실제 응답은 그보다 크다. 아래에서 다시 쟀다. 아래 §7 의 실측이 그걸 확인한다.

그래서 기존 `POST /api/v1/predictions/risk` 를 건드리지 않았다. 큐 경로는 새 엔드포인트 두 개로 나란히 붙었다.

| 경로 | 용도 |
| --- | --- |
| `POST /api/v1/predictions/risk` | **기본.** 즉시 답이 필요할 때. 왕복 26~29 ms |
| `POST /api/v1/predictions/jobs` | 작업을 큐에 넣고 `202 job_id` |
| `GET /api/v1/predictions/jobs/{job_id}` | 상태·결과 폴링 |

큐 경로를 만든 이유는 셋이다. **하나**, 워커·큐·재시도·회수를 문서가 아니라 도는 코드로 갖는다. **둘**, OCR 과 챗봇이 들어올 자리가 같은 배선이므로 미리 세워 두면 그때 인식기만 얹으면 된다. **셋**, 큐 깊이·워커 수·처리량을 실제로 재서 §7 의 `p95 300 ms` 규칙을 숫자로 검증할 수 있다.

---

## 2. Redis 두 역할과 키 공간

| 키 | 용도 | 수명 |
| --- | --- | --- |
| `ieobom:rt:{account}` · `ieobom:rt:{account}:{jti}` | 리프레시 토큰 (기존) | 토큰 만료까지 |
| `ieobom:predict:stream` | 작업 스트림. 소비자 그룹 `prediction-workers` | `MAXLEN 10000` 절단 |
| `ieobom:predict:job:{job_id}` | 상태·결과 해시 | `PREDICTION_JOB_TTL_SECONDS` = 600 초 |

`job_id` 는 무작위 UUID 다. **키에 계정·프로필 식별자를 넣지 않는다** — 넣으면 Redis 키 목록만 봐도 누가 언제 예측했는지가 드러난다.

### 지속화를 끈 이유와 대가

작업 해시에는 사용자가 입력한 건강 수치가 담긴다. RDB 스냅샷이나 AOF 로 디스크에 남으면 ADR-010 §6 의 세 번째 조건을 어긴다. `redis:alpine` 기본값은 RDB 가 켜져 있어서 명시적으로 꺼야 한다.

```yaml
command: ["redis-server", "--save", "", "--appendonly", "no"]
```

**대가는 Redis 를 재시작하면 리프레시 토큰이 사라지는 것이다.** 전원이 재로그인해야 한다. 이 문서를 쓰는 중에 실제로 그 일이 있었다 — Redis 를 강제 재생성하니 토큰 키 2 개가 사라졌다. 토큰은 다시 만들면 되는 값이고 건강 수치는 그렇지 않으므로 이 교환을 받아들인다.

별도 인스턴스로 갈라 토큰만 지속화하는 방법도 있다. 컨테이너가 하나 늘고 얻는 것이 "재시작 시 로그인 유지"뿐이라 지금은 하지 않는다.

---

## 3. 작업 생애

```
사용자 예측 버튼
  → POST /predictions/jobs
      1. HSET  job:{id}  status=queued, payload=<json>, created_at, attempts=0
      2. EXPIRE job:{id}  600
      3. XADD  stream  job_id={id}   (MAXLEN ~10000)
      → 202 { job_id, poll_after_ms: 200, expires_in_seconds: 600 }

ai-worker (3 대 중 하나)
      4. XREADGROUP  → (message_id, job_id)
      5. HGET payload → status=running, worker=<host>-<pid>, attempts+1
      6. 채점 (app.services.prediction.build_prediction)
      7. HSET status=succeeded, result=<json> · HDEL payload · EXPIRE 600
      8. XACK

  → GET /predictions/jobs/{id}
      status · worker · attempts · result
```

**해시를 먼저 쓰고 스트림에 넣는 순서가 중요하다.** 반대로 하면 워커가 스트림 메시지를 먼저 집어 해시가 아직 없는 상태를 만난다.

**스트림에는 `job_id` 만 흐른다.** payload 를 스트림에 실으면 지울 시점을 통제할 수 없다 — 스트림은 `MAXLEN` 으로 절단될 뿐 TTL 이 없다.

---

## 4. 3 대가 중복 없이 나누는 원리

Redis 소비자 그룹은 한 메시지를 그룹 안의 **한 소비자에게만** 배달한다. 워커는 `{hostname}-{pid}` 로 이름을 만들고 컨테이너마다 hostname 이 다르므로 세 대가 자동으로 서로 다른 작업을 갖는다.

**코드에 분배 로직이 없다.** `--scale ai-worker=3` 을 `=5` 로 바꿔도 코드는 그대로다.

리스트(`LPUSH`/`BRPOP`)로도 분배는 된다. 쓰지 않은 이유는 소비자가 죽는 순간 물고 있던 작업이 사라지기 때문이다. 스트림은 `XACK` 전까지 pending 에 남는다.

### `container_name` 을 빼야 한다

compose 에 `container_name: ai-worker` 가 있으면 여러 대를 띄울 수 없다 — 이름 충돌로 `--scale` 이 실패한다. 지웠고, `test_compose_ai_worker_can_scale` 이 다시 들어오는 것을 막는다.

---

## 5. 실패와 회수

| 상황 | 처리 |
| --- | --- |
| 본문 검증 실패 | 즉시 `failed` 확정 + `XACK`. 재시도해도 같은 결과다 |
| 모델 미적재 | 재배달 대기. `PREDICTION_JOB_MAX_ATTEMPTS`(3) 초과 시 `failed` |
| 채점 중 예외 | 같음. 작업 하나만 죽고 워커는 계속 돈다 |
| 작업 해시 TTL 만료 | `XACK` 만 하고 건너뜀. 되살릴 payload 가 없다 |
| 워커가 죽음 | `XAUTOCLAIM` 으로 다른 워커가 회수. `PREDICTION_JOB_RECLAIM_IDLE_MS`(60 초) 지난 것만 |

`XACK` 하지 않으면 pending 에 남는다는 성질을 재시도 수단으로 쓴다. 상한을 둔 이유는 무한 재배달이 큐를 막는 것이 더 나쁘기 때문이다.

**`restart: always` 는 크래시만 되살린다.** `docker kill` 로 죽인 컨테이너는 되살아나지 않았다 — `RestartPolicy=always` 인데 `RestartCount=0` 이었다. 도커가 명시적 종료를 사용자 의도로 보기 때문이다. 운영에서 OOM·예외로 죽는 경우는 되살아나므로 정책 자체는 유효하다.

---

## 6. 데이터 경계 — ADR-010 §6 네 조건

| 조건 | 구현 | 검사 |
| --- | --- | --- |
| TTL 이 있고 완료 즉시 payload 삭제 | `store.succeed()`·`fail()` 이 `HDEL payload` | `test_payload_is_deleted_on_success` · `test_payload_is_deleted_on_failure` · `test_ttl_is_set` |
| 키에 계정 식별자 없음 | `job_key()` 가 무작위 UUID 만 | `test_job_key_carries_no_account_identifier` |
| 지속화 끔 | compose `--save "" --appendonly no` | `test_compose_disables_redis_persistence` |
| 건강 수치를 로그·응답에 남기지 않음 | 워커 로그는 `job_id`·상태·소요 시간만. `store.read()` 가 payload 를 제외 | `test_enqueue_then_read_never_exposes_payload` |

`fakeredis` 로 도는 12 개 테스트다. Docker 를 켜지 않아도 계약이 깨지면 잡힌다.

---

## 7. 실측 (2026-08-25, 로컬 도커)

### 처리량과 분배

작업 30 건을 연속 등록하고 전량 완료까지 쟀다.

| 항목 | 값 |
| --- | --- |
| 등록 | 965 ms (건당 32.2 ms) |
| 전량 완료 | 1.90 s |
| 성공 / 실패 / 미완 | 30 / 0 / 0 |
| 워커별 처리 | 11 · 10 · 9 (최적화 후 재측정: 10 · 10 · 10) |
| `attempts` 분포 | 전부 1 (재시도 0) |
| 결과 종류 | 1 개 (같은 입력 → 같은 결과) |

### 동기 경로와의 비교

| | 왕복 | 응답 |
| --- | --- | --- |
| 동기 `POST /predictions/risk` | **26~29 ms** | 12,410 B |
| 비동기 (등록 + 첫 폴링) | 등록 32 ms + 폴링 최소 200 ms | 12,410 B |

**두 응답이 바이트 단위로 완전히 일치했다.** 채점 함수를 `app/services/prediction.py` 로 뽑아 두 경로가 공유하게 만든 결과다.

동시에 이 표가 ADR-009 §7 의 근거를 다시 확인한다 — **단건 응답만 놓고 보면 동기가 8 배 이상 빠르다.** 큐가 이기는 자리는 단건 지연이 아니라 폭주 흡수와 재시도다.

### 채점 비용 — ADR-009 의 "1.3 ms" 는 번들 1 개 기준이다

30번 문서가 적은 `1.3 ms/명` 은 **번들 하나**를 채점하는 시간이다. 화면이 쓰는 응답은 질환 10 개를 담으므로 실제 비용이 다르다. 프로파일로 재고 두 군데를 고쳤다.

| | 이전 | 이후 |
| --- | ---: | ---: |
| `build_prediction()` (질환 10 건) | 26.37 ms | **21.51 ms** |
| `refresh()` (요청마다) | 1.384 ms | **0.055 ms** |
| 요청당 계산 합계 | 27.75 ms | **21.57 ms** (−22.3%) |
| nginx 왕복 실측 | 46~48 ms | **26~29 ms** (−43%) |

**하나 — 트리를 두 번 걷고 있었다.** `probability()` 와 `contributions()` 가 같은 XGBoost 트리를 각각 순회했다. 프로파일에서 `contributions` 가 요청 시간의 24% 였다. `score_with_contributions()` 로 한 번에 낸다. 분기 조건과 잎값 합산은 한 글자도 바뀌지 않으므로 확률이 달라질 수 없고, **번들 20 개 × 케이스 36 개 = 720 채점을 대조해 완전 일치를 확인했다.**

**둘 — `refresh()` 가 요청마다 glob + stat 20 회를 돌았다.** `STAT_INTERVAL_SECONDS`(1 초) 스로틀을 걸었다. 재학습 반영이 최대 1 초 늦어지는 대신 비용이 사라진다 — 배포는 초 단위 사건이고 요청은 밀리초 단위 사건이다. 반영이 막히지 않는지는 `app/tests/model/test_registry_refresh.py` 가 검사한다.

여전히 ADR-009 §7 의 `p95 300 ms` 규칙 안이므로 동기 기본은 그대로다.

### 워커 장애

3 대 중 1 대를 `docker kill` 한 직후 15 건을 던졌다.

- 완료 15 / 성공 15 / 실패 0
- 남은 두 대가 8 · 7 로 나눠 처리
- 죽은 대가 물고 있던 작업 없음 (죽는 시점에 pending 이 비어 있었다)

### 데이터 경계

- 성공한 작업의 남은 필드: `started_at created_at finished_at status result worker attempts` — **`payload` 없음**
- TTL 552 초 / 473 초 (상한 600)
- Redis `save` = 빈 값, `appendonly` = `no`
- 워커 3 대 로그에서 입력 수치(`132`·`hemoglobin`·`"sbp"`) 검색 **0 건**
- 토큰 키 2 개와 작업 해시 32 개가 같은 인스턴스에 공존

---

## 8. 만들면서 걸린 것

**`model_dump()` 가 `computed_field` 를 넣는다.** 첫 판이 전부 `VALIDATION_ERROR` 로 실패했다. `RiskPredictionRequest` 는 `extra="forbid"` 인데 `model_dump()` 가 계산 필드 `bmi` 까지 담아서, 워커가 되검증할 때 "선언에 없는 키"로 거부했다.

**동기 경로에는 증상이 없다.** 되검증을 하지 않기 때문이다. 큐를 건너는 경로에서만 드러나는 종류라 `test_enqueued_payload_survives_revalidation` 으로 박았다.

`include=set(model_fields)` 로 선언 필드만 담아 고쳤다.

**모델 미적재를 등록 시점에 확인하지 않았다.** 처음엔 `202` 를 주고 워커가 세 번 재시도한 뒤 실패시켰는데, 재배달 간격이 60 초라 사용자가 3 분을 기다린 끝에 실패를 본다. 동기 경로는 같은 상황에서 즉시 `503` 이다. 두 경로가 같은 조건에서 다르게 답하면 안 되므로 등록 시점에 같은 검사를 넣었다.

---

## 9. 남은 것과 재검토 조건

- ~~인증이 없다~~ → **붙였다.** 아래 §11 참조.
- **폴링 대신 SSE.** 지금은 200 ms 폴링이다. 챗봇 스트리밍을 붙일 때 같은 배선을 쓸 수 있다.
- **`ai` 의존성 그룹.** 워커 이미지를 `app` 그룹으로 바꿨다(`torch` 계열이 채점에 불필요). 챗봇·임베딩을 이 워커에 얹을 때 다시 본다.
- **큐가 밀리는 지점을 아직 안 쟀다.** 동시 요청을 올려 `pending_count` 가 쌓이기 시작하는 수를 찾아야 ADR-010 §7 의 처리량 축을 채울 수 있다.
- **OCR 이 들어올 자리다.** 스트림·그룹·회수·TTR 배선이 그대로 재사용된다. 인식기를 `feat/OCR_n_ai-worker` 에서 이식해 `ai_worker/tasks/` 에 얹으면 된다.

---

## 10. 재현

```bash
cd project

# 기본 4종 (동기 예측만 필요하면 이것으로 끝)
docker compose up -d --build

# 큐 + 워커 3대
docker compose --profile ai up -d --build --scale ai-worker=3 ai-worker

# 작업 등록
curl -s -X POST http://localhost/api/v1/predictions/jobs \
  -H 'Content-Type: application/json' \
  -d '{"age":54,"sex":"M","height_cm":173,"weight_kg":78,"self_rated_health":3,"sbp":132,"dbp":84}'

# 상태 조회
curl -s http://localhost/api/v1/predictions/jobs/<job_id>

# 워커 로그 (건강 수치가 없어야 한다)
docker logs ieobom-ai-worker-1

# 계약 검사 (DB·Redis 컨테이너 불필요)
uv run --no-sync python -m pytest app/tests/model -q
```

---

## 11. 인증·레이트리밋·관측 (2026-08-25 추가)

ADR-009 §10 이 건 선행조건을 채웠다.

### 인증

건강 수치를 본문으로 받는 경로 넷에 `require_active_account` 를 걸었다. 무인증으로
전부 **401** 이다.

| 경로 | 이전 | 이후 |
| --- | --- | --- |
| `POST /predictions/risk` | 무인증 | 인증 필요 |
| `POST /predictions/jobs` | 무인증 | 인증 필요 |
| `GET /predictions/jobs/{id}` | 무인증 | 인증 필요 |
| `POST /assessments/rules` | 무인증 | 인증 필요 |

작업 조회에 계정 소유 검사는 하지 않는다. 작업 해시에 계정 식별자를 넣지 않기로
했기 때문이다(ADR-010 §6) — 무작위 128 비트 `job_id` 를 아는 것 자체가 접근 자격이고,
그 위에 로그인을 한 겹 더 얹는다.

`/api/health` 는 인증 밖이다. 컨테이너 헬스체크가 써야 한다.

### 레이트리밋

`app/services/rate_limit.py` 의 고정창 제한기다. `invitation_store.py` 가 초대에 쓰던
`INCR` + `EXPIRE nx` 패턴을 재사용 가능한 모양으로 뽑았다.

| 범위 | 상한 | 이유 |
| --- | ---: | --- |
| `predict` · `assess-rules` | 60 / 분 | 사람이 버튼을 누르는 속도 |
| `predict-job` | **20 / 분** | 큐는 한 계정이 채우면 **다른 사용자의 작업이 밀린다.** 무상태 계산인 동기 경로와 달리 남에게 피해가 간다 |

**Redis 가 죽으면 막는다(fail-closed).** 열어 두면 Redis 장애가 곧 무제한 요청이 되고,
큐가 채워지면 복구 뒤에도 한동안 밀린다.

실측 — 큐에 25 회를 연달아 던지니 **20 건 통과, 나머지 429** 였고, 같은 계정의 동기
경로는 별도 카운터라 그대로 200 이었다.

### 데모 페이지

`/api/demo` 가 예측 API 를 브라우저에서 직접 부르므로 인증을 붙이면 깨진다. 로그인 줄을
넣고 `Authorization: Bearer` 를 실어 보내게 고쳤다. **접근 토큰은 메모리에만 둔다** —
`localStorage` 에 넣으면 XSS 한 방에 털리고, 건강 수치를 다루는 화면에서 그 습관을
만들면 안 된다. 새로고침하면 다시 로그인하는 것이 그 대가다.

### 큐 깊이 관측

`/api/health` 가 `queue.pending` 을 낸다. 계속 쌓이면 워커가 못 따라가고 있다는 뜻이다.

```json
{"status":"ok","models":true,"targets":10,"queue":{"available":true,"pending":0}}
```

**Redis 가 죽어도 200 을 준다.** 동기 예측은 Redis 없이 동작하므로 여기서 503 을 주면
nginx 가 멀쩡한 서버를 죽은 것으로 보고 트래픽을 끊는다. 대신 `queue.available` 로 드러낸다.

### ai-worker 헬스체크

"떠 있음"과 "큐를 소비 중"은 다르다. `ai_worker/healthcheck.py` 가 셋을 본다 — Redis 에
닿는가, **소비자 그룹에 자기 이름이 등록됐는가**(`XREADGROUP` 을 한 번은 돌았다는 뜻),
모델이 적재됐는가.

```
healthy: consumer=bbc701917a67-10 idle=4362ms targets=10
```

`kill 1` 로 워커를 죽였더니 정상 종료 후 `restart: always` 가 되살렸다. 앞서 `docker kill`
이 안 되살아난 것과 대비된다 — 도커는 명시적 `kill` 만 사용자 의도로 본다.

### 포트 노출

`postgres`·`redis`·`fastapi` 의 호스트 포트를 **루프백에만 묶었다**. 전에는 `0.0.0.0` 이라
같은 네트워크의 다른 기기가 인증 없이 Redis 에 붙을 수 있었고, 거기엔 리프레시 토큰과
예측 payload 가 있다. 컨테이너끼리는 `ws` 네트워크로 통하므로 기능에는 영향이 없다.
공개는 `nginx:80` 하나뿐이다.

```
nginx     0.0.0.0:80->80/tcp
fastapi   127.0.0.1:8000->8000/tcp
postgres  127.0.0.1:5432->5432/tcp
redis     127.0.0.1:6379->6379/tcp
```
