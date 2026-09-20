# 이어봄 설계 용어

- 발표·요구사항·아키텍처 문서는 이 표를 따른다. 코드·API에 `ocr`가 남아 있어도 **제품 기능 이름은 OCR이 아니다.**
- 결정: [ADR-0014](adr/0014-document-vision-not-ocr.md), [ADR-0015](adr/0015-bounded-agent-on-policy-and-evidence.md)

## 문서 판독 (현재 채택)

이어봄은 전용 OCR 엔진(Tesseract, RapidOCR, CLOVA 등)으로 글자를 뽑지 않는다. 건강서류 이미지·PDF는 **멀티모달 LLM의 Vision**에 넣어 표와 텍스트를 구조화한다.

| 말할 때 | 쓰지 말 것 | 뜻 |
|---|---|---|
| 문서 Vision 판독, 멀티모달 LLM Vision | OCR, 클라우드 OCR, 로컬 OCR | Gemini 등 Vision 모델이 서류를 보고 JSON으로 구조화하는 경로 |
| 판독 초안, Vision 결과 | OCR 결과 (대외·설계 서술) | 모델이 돌려준 표·텍스트·수치 후보. 확정 전 값 |
| 사용자 확정값 | 자동 OCR 저장 | 사람이 검수·수정한 뒤에만 건강기록이 됨 |
| RapidOCR, Tesseract, PP-OCR, CLOVA | (현재 제품 경로가 아님) | ADR-0008·0010 당시 기준선·제안. 엔진 자리는 ADR-0014가 대체 |

기본 모델은 `gemini-3.5-flash-lite`다. 실패 시에만 설정한 예비 모델(예: `openai:gpt-4o`)로 넘어간다. 실제 호출 모델은 로그의 `model=`로 확인한다.

이 경로는 **에이전트가 아니다.** 서류 한 장을 한 번 읽고 초안을 돌려주는 파이프라인이다. 확정값은 ADR-0011에 따라 서버 정본에 저장한다.

에이전트 도입 시에도 원본 판독은 대화형 도구가 아니다. 사용자 확정값만 필요한 기간·필드로 조회한다. 기준: [ADR-0015](adr/0015-bounded-agent-on-policy-and-evidence.md), [54_agent_baseline.md](54_agent_baseline.md).

개발·검증 단계에서는 합성·비식별 문서만 외부 Vision에 보낸다. 화면에도 그렇게 고지한다.

## 대화·에이전트

| 말할 때 | 쓰지 말 것 | 뜻 |
|---|---|---|
| 제한형 챗봇, 단일 단계 tool calling | 에이전트 (현재 구현) | 서버가 근거를 채운 뒤 허용 도구를 한 차례 고름 |
| bounded 에이전트 | 자율 상담원, 완전한 에이전트 | ADR-0011·0012·0013이 잠근 도구 집합 안에서 최대 N번 다음 행동을 선택 |
| 필수 자료 미리 준비 | 모델이 지식 도구를 고름 | 의료 주장·건강기록 답변은 서버가 근거를 먼저 가져온다. 코드·영문에서는 prefetch |
| 픽셀 마스킹 | 프롬프트로 개인정보 무시 | 외부 Vision 전송 전에 사본에서 식별 영역을 지움 |

## 코드에 `ocr`가 보이는 이유

구현·큐·에러 코드는 초기에 OCR로 이름 붙였다. 계약을 깨지 않으려고 식별자는 유지할 수 있다.

| 코드·스키마 | 설계 문서에서 부를 이름 |
|---|---|
| `/documents/ocr`, `/dev/ocr`, `TaskName.OCR_EXTRACT` | 문서 Vision 판독 API·작업 |
| `OcrResult`, `ocrResults`, `source: "ocr"` | 문서 Vision 판독 초안 저장소·출처 |
| `OCR_UNAVAILABLE` | 문서 Vision 판독을 쓸 수 없음 |
| `DEV_OCR_MODELS` | Vision 판독 모델 시도 목록 |

설계를 읽다가 `ocr`가 나오면 **구 식별자**로 보고, 이 문서의 ‘문서 Vision 판독’으로 번역한다. ADR-0008·0010 본문의 OCR은 당시 초안이다.
