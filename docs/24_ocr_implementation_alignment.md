# OCR 챌린지 구현 정렬·개발 진행 설계

> 상태: 검토 요청
> 기준일: 2026-08-20
> 상위 문서: [ADR-008 개발 검증용 클라우드 OCR 기준선 허용](adr/0008-temporary-cloud-ocr-baseline.md), [OCR 클라우드 기준선·로컬 대체 챌린지](16_ocr_cloud_baseline_local_replacement_challenge.md)
> 이 문서는 챌린지 문서의 작업 패키지를 현재 저장소 상태에 붙이는 실행 설계다. 정책은 ADR-008, 평가 방법은 16번 문서를 따르고 여기서 바꾸지 않는다.

## 1. 확인 결과

16번 문서는 새 기능의 백지 설계로 읽히지만 실제로는 그렇지 않다. `feat/OCR_n_ai-worker` 브랜치(commit `7e162b1`)에 이미 OCR 구현이 있고, 그 구현이 ADR-008과 정면으로 어긋난다. 브랜치는 `dev`에 병합되지 않았다.

즉 이 챌린지의 첫 작업은 B1 후보 측정이 아니라 **기존 구현과 승인된 결정의 정렬**이다. 정렬하지 않고 16번 문서의 패키지를 착수하면 같은 기능의 두 구현이 서로 다른 데이터 경계를 갖고 병렬로 자란다.

### 1.1 충돌 목록

| # | ADR-008·16번 문서의 규정 | `7e162b1`의 구현 | 판정 |
|---|---|---|---|
| C1 | ADR-008 검토한 대안: "원본이나 결과를 Redis에 짧은 TTL로 저장" → **기각**. "비동기 상태가 필요하면 문서 내용이 없는 작업 식별자·상태·만료 시각만 저장한다" | `app/core/jobs/store.py:37` — 업로드 이미지를 base64로 감싸 `SET job payload EX 300`. 같은 파일 `:38`,`:60-68` — OCR 결과 전문을 `JobRecord.result`에 담아 `SET job record EX 600` | 명시적 기각 항목을 그대로 구현 |
| C2 | ADR-008 결정: FastAPI는 중계만 하고 "원본 문서와 OCR 결과를 PostgreSQL, **Redis**, 서버 파일시스템, 요청 로그, APM payload에 저장하지 않는다" | 위와 같음 | 직접 위반 |
| C3 | 16번 문서 §2 계약: `processingLocation: "device" \| "external-provider"`. 클라우드 기준선 엔진은 Naver CLOVA OCR | `app/services/ocr/engine.py` — 서버 자체 호스팅 RapidOCR(PP-OCR ONNX)로 서버에서 추론. `ai_worker/tasks/ocr.py`가 `app.services.documents.DocumentOcrService`를 import해 워커가 추론 주체 | 계약에 없는 제3의 처리 위치 |
| C4 | `dev`의 [05_tech_architecture.md](05_tech_architecture.md) §2: "건강정보를 외부 API나 **서버 AI 워커**로 보내는 구조는 현재 로컬 보관 원칙과 맞지 않으므로 사용하지 않는다". §4 서버 금지 항목: "원본 건강서류와 OCR 결과" | 워커가 건강문서를 받아 추론 | 직접 위반 |

### 1.2 브랜치의 자기 정당화가 무효가 된 경위

`7e162b1`은 `docs/05_tech_architecture.md` 2-1절을 함께 수정해 서버 OCR 예외를 적어 넣었다. 그 수정은 `dev`에 없다. `dev`의 05번 문서는 여전히 금지 상태이고, 같은 날 승인된 ADR-008이 Redis TTL 보관을 기각 사유까지 붙여 닫았다. 브랜치가 근거로 삼은 문서 조항이 병합되기 전에 상위 결정으로 대체됐다.

따라서 이 충돌은 "어느 문서가 맞나"의 문제가 아니다. ADR-008이 승인 상태이고 16번 문서가 그 실행 계획이므로, 코드를 ADR에 맞춘다.

### 1.3 역방향은 권장하지 않는다

서버 자체 호스팅 OCR을 허용하도록 ADR-008을 개정하는 선택지가 형식상 있다. 후속 ADR이 필요하고, 다음을 감수해야 한다.

- 건강문서가 사용자 기기를 떠나는 것이 예외가 아니라 기본 경로가 된다. 로컬 우선이라는 제품 설명과 05번 문서 §3 시스템 경계 그림이 동시에 깨진다.
- 16번 문서의 두 트랙 비교 구조가 무의미해진다. 트랙 B의 존재 이유가 트랙 A를 대체하는 것이다.
- ADR-001·002·007이 함께 흔들린다. 로컬 보관함 격리(ADR-007)를 최우선 보안 후속으로 두고 있는 상황과 맞지 않는다.

RapidOCR의 실측 성능이 좋다는 것은 사실이지만 그것은 엔진 선택의 근거이고, 처리 위치를 바꿀 근거가 아니다. RapidOCR은 브라우저 후보로 다시 평가한다(§4.2 B2).

## 2. 정렬 원칙

1. 서버는 Naver 중계 한 곳만 갖는다. 무상태·무저장·동기다.
2. 서버에서 건강문서를 추론하지 않는다. `ai_worker`는 OCR 경로에서 빠진다.
3. 엔진에 종속되지 않는 자산(항목 사전, 표 조립, 후처리 규칙, 픽스처, 채점기)은 전부 살린다. 이 자산이 이 브랜치의 실질 가치다.
4. 이동은 16번 문서 §10의 경로를 기준으로 하되, `dev`에서 이미 동작하는 화면을 깨지 않는다.

## 3. 자산 처분

### 3.1 살린다 — 위치만 옮기거나 그대로 둔다

| 현재 경로 | 규모 | 판정과 이유 | 이동 후 | 작업 ID |
|---|---|---|---|---|
| `app/services/ocr/lexicon.py` | 252줄 | 검진표 항목 사전. 엔진과 무관한 도메인 지식이다. 라틴 접두사·단위·참고치를 함께 보고 항목을 특정하는 방식은 한글 라벨 인식이 약한 모든 후보에 그대로 쓸 수 있다 | TS로 이식 → `frontend/src/shared/ocr/checkupLexicon.ts`. Python 원본은 채점기 쪽에 남긴다 | OCR-B-003 |
| `app/services/ocr/extractor.py` | 206줄 | 표 행 조립기. 좌표에서 행을 만들고 라벨·값·단위를 잇는 로직으로 B1~B5 전 후보의 공통 후처리다 | 같음 → `frontend/src/shared/ocr/rowAssembler.ts` | OCR-B-003 |
| `app/dtos/documents.py` `OcrRowData`·`OcrExtractionData` | 64줄 | 이미 `unit`·`reference`·`signals`·`needs_review`를 갖고 있다. 16번 문서 §2의 `OcrField`가 필요한 것이 이 모양이다. 새로 설계하지 말고 이걸 정본으로 승격한다 | `frontend/src/shared/ocr/contracts.ts`가 정본. 서버 쪽은 중계 응답 스키마로 축소 | OCR-COM-001 |
| `frontend/local-domain/ocr/*` | 793줄 | 이미 트랙 B1이다. 영역 기반 Tesseract 호출, 표 추출, 형광펜 제거(적색 채널), 자동 영역 검출까지 있다. `dev`의 `browserOcrAdapter.ts`(전체 페이지 → 평문)보다 상위 구현이다 | `frontend/src/shared/ocr/` 아래로. §3.3 참조 | OCR-B-001 |
| `frontend/fixtures/*`, `frontend/scripts/{make-fixtures,score-fixtures,bench-labels,verify-ocr}.ts` | 483줄 | 픽스처 생성과 채점의 골격이 이미 있다. 16번 문서 §11~12의 명세를 만족하도록 확장하면 된다 | `benchmarks/ocr/`, `scripts/` | OCR-DATA-001, OCR-BENCH-001 |
| `scripts/score_ocr_api.py` | 105줄 | API 응답 채점기. 엔진 무관 채점기로 일반화한다 | `scripts/benchmark_ocr.py` | OCR-BENCH-001 |
| `app/core/jobs/*`, `ai_worker/consumer.py` | 174줄 + 소비자 | 큐 자체는 잘 만들어져 있다. 소비자 그룹, ack, `XAUTOCLAIM` 재배달, 재시도 상한, SIGTERM 정상 종료. 다만 `TaskName`에 `OCR_EXTRACT` 하나뿐이라 OCR이 빠지면 소비자가 없어진다 | 유지하되 payload 보관을 제거하고, 로드맵의 후속 항목인 실제 이메일 공급자 워커로 용도를 옮긴다. §3.2 C1 참조 | 별건 |
| `ocr_test.py` (저장소 루트) | 89줄 | 이미 동작하는 Naver CLOVA 호출 spike다. `NAVER_OCR_URL`·`NAVER_OCR_SECRET` 패턴까지 잡혀 있다. 트랙 A의 출발점 | `app/integrations/naver_ocr/client.py`로 정리해 흡수하고 루트에서 제거 | OCR-A-001 |

### 3.2 버린다

| 대상 | 이유 | 대체 |
|---|---|---|
| `app/core/jobs/store.py`의 `payload`·`result` 보관 (`enqueue`의 첫 `SET`, `read_payload`, `discard_payload`, `JobRecord.result`) | C1·C2. ADR-008이 기각한 항목 | 문서 내용 없는 `job_id`·`status`·`expires_at`만 남긴다. OCR 경로에서는 큐 자체를 쓰지 않는다 |
| `ai_worker/tasks/ocr.py`, `consumer.py`의 OCR 분기 | C3·C4. 서버 워커가 건강문서를 추론한다 | 없음. OCR은 기기 또는 Naver 중계로만 실행한다 |
| `app/services/ocr/engine.py` (RapidOCR 런타임) | C3. 서버 추론 | 제품 경로에서 제거. 벤치마크 참조 구현으로 `benchmarks/ocr/reference/`에 격리하고 서버 이미지에서 뺀다. `app/Dockerfile`의 `libgl1`·`glib` 추가와 `ocr` 의존성 그룹도 함께 되돌린다 |
| `POST /documents/ocr` 202 + `job_id` 비동기 계약, `GET /documents/ocr/{job_id}` | 16번 문서 §2의 흐름은 클라이언트 주도 동기 흐름이다. 비동기로 만든 유일한 이유가 서버 추론이었고 그것이 없어진다 | 동기 중계 하나. §4.1 참조 |

`app/services/documents.py`의 검증 로직(형식·크기·해상도)은 중계 앞단에 그대로 필요하므로 남긴다. 추론 호출부만 교체한다.

### 3.3 프론트엔드 경로 통합

현재 브라우저 OCR 코드가 세 곳에 흩어져 있다.

| 위치 | 내용 | 상태 |
|---|---|---|
| `dev` `frontend/src/shared/local/browserOcrAdapter.ts` | 전체 페이지 Tesseract → 평문. PDF 렌더링 포함 | `frontend/src/features/data/DataManagementPage.tsx:7,155`에서 사용 중. 로드맵에 "완료"로 기록된 화면이다 |
| 브랜치 `frontend/local-domain/ocr/*` | 영역 기반 인식 + 표 추출 + 사전 매칭 → 구조화 행 | `src` 밖이라 빌드·테스트 경로에서 벗어나 있다 |
| 16번 문서 §10 `frontend/src/shared/ocr/` | 목표 구조 | 아직 없음 |

통합 방향은 다음과 같다. 살아 있는 화면을 먼저 깨지 않는 순서다.

```text
frontend/src/shared/ocr/
├─ contracts.ts              # OcrEngine, OcrResult, OcrField, 오류 코드 (정본)
├─ engineRegistry.ts         # 엔진 선택과 처리 위치 노출
├─ engines/
│  ├─ browserTesseractEngine.ts   # local-domain/ocr/tesseract-engine.ts + dev의 PDF 렌더링 병합
│  ├─ paddleOcrEngine.ts          # B2에서 추가
│  └─ naverCloudOcrEngine.ts      # 서버 중계를 호출하는 어댑터
├─ rowAssembler.ts           # local-domain/ocr/{table,line}-extractor.ts
├─ autoRegions.ts            # local-domain/ocr/auto-regions.ts
├─ checkupLexicon.ts         # app/services/ocr/lexicon.py 이식
└─ workers/localOcr.worker.ts
```

`browserOcrAdapter.ts`는 `browserTesseractEngine.ts`로 흡수하되, 통합 PR에서 `DataManagementPage`가 새 계약으로 같이 옮겨가야 한다. PDF 페이지 렌더링(`renderPdfPages`)은 엔진이 아니라 입력 전처리이므로 `inputRasterizer.ts`로 분리한다. 16번 문서 §11.3이 요구하는 "같은 해상도·색상 규칙으로 rasterize"의 구현 지점이 여기다.

## 4. 목표 아키텍처

### 4.1 트랙 A — Naver 중계

```text
브라우저                          FastAPI                      Naver CLOVA
──────────────────────────────────────────────────────────────────────────
파일 선택
엔진 선택 (external-provider 명시 확인)
  │
  ├─ POST /documents/ocr:relay ──▶ 형식·크기·해상도 검증
  │   multipart, 동기                 │
  │                                  ├─▶ 메모리에서 그대로 전달 ──▶ 인식
  │                                  │                              │
  │                                  ◀── 응답 정규화 ◀──────────────┘
  ◀── 200 OcrResult ─────────────────┘  (요청·응답 본문 로그 금지)
  │
사용자 검토·수정
  │
확정값만 IndexedDB 암호화 저장 → 로컬 집계·차트
```

경계 규칙은 다음과 같다.

- 요청 본문은 요청 처리 중 메모리에만 존재한다. `UploadFile`의 `SpooledTemporaryFile`이 디스크로 넘어가지 않도록 `spool_max_size`보다 작은 크기 상한을 강제하거나 `BytesIO`로 직접 읽는다. 이 항목은 §6의 테스트로 증명한다.
- Naver Secret은 서버 환경변수에만 둔다. `envs/example.local.env`·`example.prod.env`에 `NAVER_OCR_URL`·`NAVER_OCR_SECRET` 항목을 추가하고 값은 비운다.
- 예외 처리에서 원본 응답 본문을 그대로 재전송하지 않는다. `app/integrations/naver_ocr/redaction.py`가 오류·로그 경로에 나가는 값에서 인식 텍스트를 제거한다.
- 엔드포인트는 계정 인증을 요구하고 호출 속도를 제한한다. ADR-008의 "무제한 호출 없음"과 §9 OCR-A-003의 비용표가 여기 걸린다.

경로 이름을 `POST /documents/ocr`에서 바꿀지는 [03_api_spec.md](03_api_spec.md) 담당과 합의한다. 응답 형태가 202 job에서 200 결과로 바뀌므로 명세 개정이 필요하다.

### 4.2 트랙 B — 기기 내 실행

16번 문서 §4의 단계를 현재 자산에 맞춰 다시 적는다.

| 단계 | 16번 문서 | 현재 상태 반영 |
|---|---|---|
| B1 | Tesseract 한국어 + 전처리 | **이미 있다.** `frontend/local-domain/ocr/*`. 이동·측정만 하면 기준선이 선다 |
| B2 | PaddleOCR 한국어·PaddleOCR.js | RapidOCR이 PP-OCR ONNX다. 서버에서 검증된 그 모델 자산을 `onnxruntime-web`으로 브라우저에 올리는 것이 가장 짧은 경로다. 서버 추론은 버리지만 **모델 선택 결과와 측정 경험은 그대로 쓴다** |
| B3 | ONNX Runtime Web WASM·WebGPU | B2와 같은 작업의 실행기 축이다. 자체 호스팅 + SHA-256 manifest |
| B4 | PaddleOCR-VL 로컬 실행 | 일정 압박 시 첫 축소 대상. 16번 문서 §8의 우선순위 그대로 |
| B5 | OCR + 검진 규칙 결합 | **부분적으로 있다.** `lexicon.py` + `extractor.py`가 B5의 절반이다. 위험 변환 방어 규칙을 추가한다 |

브랜치 커밋 메시지의 실측치(RapidOCR 9/9·1.8초, Tesseract 7/9·4초, PaddleOCR 9/9·16초)는 서버 실행 환경의 소규모 픽스처 결과다. 16번 문서 §13이 "AI가 주장한 성능 수치는 저장된 실행 결과 없이 문서에 확정값으로 옮기지 않는다"고 못 박았으므로, 이 값을 챌린지 기준선으로 옮기지 않는다. 엔진 후보 순위를 정하는 사전 정보로만 쓰고, §14 양식의 기준선은 고정 데이터셋으로 다시 만든다.

## 5. 작업 패키지 실행 매핑

16번 문서 §9의 패키지를 실제 PR 단위로 붙인다. 정렬 작업 두 건(ALIGN-1·2)을 앞에 추가한다.

| 순서 | ID | 내용 | 선행 | 주요 경로 | 완료 조건 |
|---:|---|---|---|---|---|
| 0 | ALIGN-1 | 서버 OCR 추론·Redis payload 제거 | 없음 | `app/core/jobs/store.py`, `ai_worker/tasks/ocr.py`, `ai_worker/consumer.py`, `app/services/ocr/engine.py`, `app/Dockerfile`, `pyproject.toml` | Redis에 문서 본문·인식 결과를 쓰는 코드 경로가 없다. 워커가 뜨고 죽지 않는다. `dev`의 05번 문서 §2·§4와 코드가 어긋나지 않는다 |
| 0 | ALIGN-2 | 프론트 OCR 경로 통합 | 없음 | `frontend/src/shared/ocr/`, `frontend/src/features/data/DataManagementPage.tsx` | `local-domain/ocr`가 `src/shared/ocr`로 들어오고 기존 검토 화면이 새 계약으로 동작한다. `local-domain/` 디렉터리가 비면 제거 |
| 1 | OCR-COM-001 | `OcrEngine`·`OcrResult`·오류 코드 확정 | ALIGN-2 | `frontend/src/shared/ocr/contracts.ts` | mock·Naver·local 어댑터가 같은 계약 테스트를 통과 |
| 2 | OCR-DATA-001 | 합성 문서·정답 v0.1 | 필드 스키마 합의 | `benchmarks/ocr/`, `scripts/generate_ocr_fixture.py` | 실제 개인정보 0건. 레이아웃·난이도별 최소 5페이지. manifest에 분할·해시·버전 |
| 3 | OCR-A-001 | Naver 메모리 중계 | OCR-COM-001 | `app/integrations/naver_ocr/`, `app/apis/v1/document_routers.py` | §6의 경계 테스트 전부 통과 |
| 3 | OCR-B-001 | Tesseract 전처리 기준선 | ALIGN-2, OCR-DATA-001 | `frontend/src/shared/ocr/engines/browserTesseractEngine.ts` | 고정 데이터셋 결과 재현 가능 |
| 4 | OCR-BENCH-001 | 공통 채점기 | OCR-COM-001, DATA-001 | `scripts/benchmark_ocr.py` | 같은 명령으로 후보별 결과표 생성 |
| 4 | OCR-A-002 | 전송 선택·안내·검토 화면 연결 | OCR-A-001 | `frontend/src/features/data/`, `engineRegistry.ts` | 묵시적 fallback 없음. 확정 전 저장 없음 |
| 5 | OCR-B-003 | 검사명·수치·단위 후처리 | OCR-B-001 | `rowAssembler.ts`, `checkupLexicon.ts` | 위험 변환 방지·저신뢰 표시 테스트 통과 |
| 5 | OCR-B-002 | PaddleOCR.js 또는 ONNX Web 기술검증 | OCR-COM-001 | `engines/paddleOcrEngine.ts`, 모델 manifest | 자체 호스팅 모델로 오프라인 OCR 1회 성공 |
| 6 | OCR-A-003 | 경계·비용·실패 시나리오 점검 | OCR-A-001~002 | 체크리스트, 호출 비용표 | 비밀값 노출·payload 잔존·무제한 호출 없음 |
| 6 | OCR-B-004 | 로컬 문서 VLM 가능성 측정 | OCR-DATA-001 | 보고서 | 채택·제한적 사용·보류 중 결론 명시 |
| 7 | OCR-DEC-001 | 최종 기본 엔진 판단 | 전부 | 선택 보고서, 후속 ADR 초안 | 채택 게이트와 기각 이유가 추적 가능 |

ALIGN-1과 ALIGN-2는 서로 독립이라 병렬로 간다. 두 건 모두 `dev` 기준으로 새 브랜치를 딴다. `feat/OCR_n_ai-worker`를 그대로 병합하지 않는다.

## 6. 경계 테스트 설계

ADR-008이 요구하는 "DB·Redis·파일·본문 로그 기록 0건"은 주장이 아니라 자동 검증이어야 한다. 16번 문서 §16이 "코드와 테스트에서 확인된다"고 쓴 부분의 구현 설계다. 이것이 이 정렬 작업의 핵심 산출물이다.

| 경계 | 검증 방법 | 실패 조건 |
|---|---|---|
| Redis | 중계 요청 동안 Redis 클라이언트를 감시 프록시로 감싸고 실행된 명령을 수집한다. 쓰기 명령(`SET`·`XADD`·`HSET`·`LPUSH` 등) 인자에 업로드 바이트나 인식 텍스트가 나타나면 실패 | 쓰기 명령 인자에 문서 유래 값 1건 이상 |
| PostgreSQL | `SQLAlchemy` `before_flush`·`after_cursor_execute` 이벤트를 붙여 중계 요청 범위의 SQL과 파라미터를 수집. 중계 경로는 애초에 세션을 열지 않는 것이 정답이므로 세션 획득 자체를 실패로 본다 | 중계 요청에서 DB 세션 획득 또는 flush 발생 |
| 파일시스템 | 요청 전후로 `tempfile.gettempdir()`과 작업 디렉터리 스냅샷을 비교. `UploadFile`의 스풀 임계 초과로 임시 파일이 생기는지 함께 본다 | 요청 종료 후 신규 파일 잔존, 또는 요청 중 스풀 파일 생성 |
| 로그·오류 | `caplog`으로 전체 로그를 잡고, 픽스처에 심어 둔 고유 표식(예: 정답값에만 존재하는 문자열)이 어느 레코드에도 없음을 확인. 예외 경로도 같이 검사한다 | 로그·예외 메시지·응답 오류 본문에 표식 등장 |
| 브라우저 트랙 외부 요청 | Playwright로 로컬 엔진 실행 중 네트워크 요청을 기록. 모델 최초 설치 이후 실행에서 요청 0건. `dev`에 이미 `frontend/e2e/local-boundary.spec.ts`가 있으므로 여기에 붙인다 | 모델 설치 후 실행에서 외부 요청 1건 이상 |
| 확정 전 저장 | OCR 결과만 받은 상태에서 IndexedDB·OPFS에 건강기록이 생기지 않고, 사용자 확정 후에만 생기는지 검증 | 확정 없이 기록·차트에 반영 |

표식 방식이 중요하다. "민감정보가 없다"는 부정형은 검증할 수 없으므로, 합성 픽스처의 값 자체를 검색 가능한 표식으로 설계한다. `OCR-DATA-001`의 정답 생성 스크립트가 표식을 심고 경계 테스트가 그것을 찾는다. 두 작업을 한 사람이 하지 않도록 하는 편이 낫다.

## 7. 일정 정렬

[07_roadmap.md](07_roadmap.md)의 스프린트와 16번 문서 §8의 게이트에 ALIGN 작업을 끼운다. 배포 데드라인 9/14는 움직이지 않는다.

| 기간 | 스프린트 | 이 문서의 작업 | 종료 게이트 |
|---|---|---|---|
| 8/20~8/23 | Sprint 2 잔여 | ALIGN-1, ALIGN-2, OCR-COM-001 착수 | 서버에 건강문서 추론·보관 경로가 없다. 같은 계약으로 두 엔진을 호출할 수 있다 |
| 8/24~8/30 | Sprint 3 | OCR-DATA-001, OCR-A-001, OCR-B-001 | 합성 문서의 숫자·단위가 검토 화면과 IndexedDB까지 연결된다. §6 경계 테스트가 CI에서 돈다 |
| 8/31~9/06 | Sprint 4 | OCR-BENCH-001, OCR-A-002, OCR-B-003 | 벤치마크 v0.1 고정. 브라우저 후보 1개 이상을 Naver와 같은 데이터로 비교 |
| 9/07~9/13 | Sprint 5 | OCR-B-002, OCR-A-003, OCR-B-004 | 최종 평가 세트 동결. 로컬 기본 후보·추가 연구·보류 중 하나 선택 |
| 9/14 | Sprint 6 시작 | 배포 동결 | 외부 전송이 기본 동작이 아니고 데이터 경계 E2E 통과 |
| 9/15~9/20 | Sprint 6 | OCR-DEC-001, 재현 문서 정리 | 시연 절차·결과표·재현 명령 완성 |
| 9/21 | 마감 | 제출 | ADR·챌린지 보고서·시연 자료의 결론이 서로 같다 |

ALIGN-1은 8/23까지 끝내는 것이 좋다. 늦어질수록 `feat/OCR_n_ai-worker`와 `dev`의 격차가 벌어져 이식 비용이 커진다.

## 8. 위험과 대응

| 위험 | 징후 | 대응 |
|---|---|---|
| ALIGN-1이 워커를 비게 만든다 | `TaskName`에 `OCR_EXTRACT` 하나뿐이라 OCR을 빼면 소비자가 없다. `restart: always`와 맞물려 컨테이너 무한 재시작이 재발할 수 있다 | 큐 인프라는 남기고 로드맵 후속 항목인 이메일 공급자 워커로 용도를 옮긴다. 그 전까지는 `docker-compose.yml`에서 워커를 비활성으로 둔다 |
| ALIGN-2가 동작 중인 화면을 깬다 | `DataManagementPage`가 `BrowserOcrAdapter`를 직접 쓴다. 로드맵에 완료로 기록된 기능이다 | 어댑터를 지우지 않고 새 계약 위에 얇은 호환 래퍼로 남긴 뒤 화면 이관을 같은 PR에서 끝낸다. 이관 완료 후 별도 커밋으로 래퍼 제거 |
| Naver 계정·키가 준비되지 않았다 | `ocr_test.py`는 spike라 `.env` 수동 설정에 의존한다. `envs/example.*.env`에 항목이 없다 | 트랙 A 착수 전에 키 발급 주체와 비용 한도를 정한다. 준비 전에는 mock 어댑터로 OCR-COM-001과 검토 화면을 먼저 완성한다 |
| RapidOCR 브라우저 이식이 막힌다 | 연산자 미지원, WASM 메모리, 모델 크기 | B1(Tesseract) 기준선이 이미 있으므로 제품 일정은 유지된다. B2 실패를 결과로 기록하고 B4로 넘어가지 않는다 |
| 문서 간 결론이 갈린다 | 05번 문서 §2, ADR-008, 16번 문서, 03번 API 명세가 서로 다른 OCR 경로를 설명한다 | ALIGN-1 PR에서 05번 문서 §2와 03번 API 명세를 함께 고친다. 코드만 고치고 문서를 남기면 다음 사람이 같은 충돌을 다시 만든다 |
| 담당자 공백 | 데이터·ML 담당 미지정 (07번 문서 §2) | 16번 문서 §9대로 패키지 착수 시 합의한다. 경계 변경과 정확도 결론은 한 사람이 단독 확정하지 않는다 |

## 9. 즉시 결정이 필요한 항목

1. **ALIGN 방향 확인** — ADR-008에 코드를 맞춘다(권장). 반대로 가려면 서버 OCR을 허용하는 후속 ADR과 §1.3의 감수 사항 수용이 필요하다.
2. **`feat/OCR_n_ai-worker` 처분** — 병합하지 않고 이식 원본으로만 둔다. 브랜치를 살려 둘지 태그만 남기고 닫을지 정한다.
3. **Naver 키 발급 주체와 비용 한도** — 트랙 A 착수 선행조건이다.
4. **API 경로 변경 승인** — `POST /documents/ocr`의 202 비동기 계약을 200 동기 중계로 바꾼다. 03번 명세 담당과 합의한다.
