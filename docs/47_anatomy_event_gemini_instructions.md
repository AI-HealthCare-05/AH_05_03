# 47. Gemini 실행 지침 — 해부학 이벤트와 통증 의미 연결

작성: 2026-09-08. 상태: **구현 전 실행·평가 계획**.
브랜치: `feat/anatomy-event-contract`
작업 폴더: `/Users/fabxoe/workbench/ieobom-anatomy-events`
기준 커밋: `b51a800e361c55c25c2b1b3bb26127ff15fc4854` (`origin/dev`).

## Gemini에게 주는 실행 요청

구현 시작 지시를 받으면 이 문서 전체를 독립 명세로 삼아, 실제 3D 입력 → 검증된 해부학 이벤트 → 권한 있는 저장 → 다시 보기 → 근거를 가진 통증 맥락 해석을 작은 수직 흐름부터 완성한다. JSON 예시만 만들거나 LLM에 mesh 이름을 넘기는 것으로 끝내지 않는다.

착수 계약: AGENTS.md, docs/34, ADR 인덱스와 **승인된 ADR-011**, frontend/README.md, docs/17, docs/43, 관련 API/도메인 계약을 읽는다. docs/43의 과거 로컬 우선 설명과 충돌하면 ADR-011이 우선한다. 목표 칸은 입력 의미화 → 저장·조회 → 서버 해석 → 불확실성·권한 실패 처리다. 변경 파일/마이그레이션/테스트/롤백을 먼저 선언한다.

## 1. 문제와 경계

사용자는 브라우저 TypeScript의 Vanatome/BodyParts3D에서 통증을 칠하고, 백엔드 LLM이 부위·통증 양상·일기·운동 후 완화를 함께 추론하기 원한다. 프런트와 백엔드가 다른 위치에 있다는 사실은 장애물이 아니다. 렌더 mesh의 삼각형 번호만 보내면 해부학 의미와 버전 안정성이 부족하다는 것이 문제다.

다음 네 항목은 절대로 하나로 합치지 않는다:

1. 사용자가 보고한 통증 위치·양상.
2. UI에서 사용자가 선택/확정한 해부학 구조.
3. 광선·깊이 계산으로 얻은 기하학적 후보.
4. 모델이 근거로 제안한 임상적 가설.

피부 위를 칠했다고 아래 장기의 질환을 확정하지 않는다. 사용자의 장기 선택도 그 장기가 실제 통증 원인임을 증명하지 않는다. 공간적 인접성과 신경 지배·연관통 관계는 다르다.

## 2. 현재 코드에서 시작할 곳

- `frontend/src/features/home/VanatomeBodyMap.tsx`: `SelectedStructure`와 raycast/선택 콜백. 현재 이름·계통만 전달하는 손실 경로를 추적한다.
- `frontend/src/features/home/anatomyAtlas.ts`: anatomyId/sourceKey/label/system/visualRole/selectable와 manifest 변환. slug fallback을 검증 없이 canonical ID로 승격하지 않는다.
- `frontend/src/features/pain-diary/PainDiaryPage.tsx`, shared domain/runtime 건강기록 저장 경로.
- `app/services/health_assistant.py`, `app/services/pain_chat.py`, 관련 DTO/라우터/프롬프트/테스트.
- `app/dtos/health_assistant.py`, 프런트 healthAssistantClient와 수동 DTO 복제 여부. 기존 문장 정리 도구와 새 임상 맥락 기능은 다르다.

여기서 경로를 찾되 기존 인증·기록 서비스를 우회하는 별도 저장 시스템을 만들지 않는다. skin이 현재 선택 불가인 경우 구조 선택과 표면 통증 입력의 pickability를 분리한다.

## 3. 이벤트 계약 설계 — 이 브랜치가 정본 소유

명명은 구현 검토에서 확정한다. 아래는 필수 의미이지 이미 존재하는 공식 표준 스키마가 아니다. 프로젝트의 버전 있는 계약을 만들고 가능한 개념은 검증된 해부학 용어체계에 매핑한다.

| 영역 | 필수 내용과 검증 |
|---|---|
| 식별/버전 | schemaVersion, eventId, atlasId/version, asset hash, topology revision; 중복 요청 방지 |
| 개념 | canonicalConceptId, sourceMeshId/sourceKey, mapping status; 1개 개념의 여러 mesh 허용 |
| 위치 | 신체 기준 left/right/midline/bilateral/unknown, 영역·표면 방향·계통·층 |
| 기하 | 명시적 좌표계/단위/변환, local 또는 bind-pose point, normal; 선택적 faceIndex/barycentric/UV |
| 입력 출처 | tap/brush/search/dental/depth, 사용자 기록 시각과 서버 수신 시각 |
| 확정 상태 | 표면 보고, 기하 후보, 사용자 확정 항목을 별도 필드·타입으로 구분 |
| 범위 | 브러시 반경·샘플·추정 피복률·복수 부위; 상한과 계산 방법 |
| 불확실성 | unknown/unmapped/unavailable/partial; 정밀 복원 불가 이유 |

추가 원칙:

- atlas의 남성/여성 기준 모델은 실제 환자 성별 추정값이 아니다.
- 화면 왼쪽과 환자 왼쪽을 혼동하지 않는다. 회전·반사·스케일 테스트가 필요하다.
- faceIndex와 barycentric은 같은 자산 해시/topology에서만 유효하다. 개념 ID로 삼지 않는다.
- 법선은 올바른 normal matrix로 변환한다. 움직이는/skinned geometry의 기준 자세와 변환도 기록한다.
- 좌표를 bounding box 0~1로 바꾸기만 해서는 새 topology에 정확히 복원할 수 없다.
- source label을 서버가 신뢰해 임상 컨텍스트로 쓰지 않는다. registry로 ID와 계통/좌우를 검증한다.
- 표준 용어/FMA 등의 식별자를 추정 생성하지 않는다. 원본 메타데이터, 라이선스, 출처, 매핑 근거를 보존한다.
- 수집하는 모든 필드는 저장/복원/검증/해석 중 실제 소비 경로와 테스트가 있어야 한다. 유령 DTO 입력 금지.

## 4. 칠하기와 topology 변경

사용자가 원하는 것은 구조 하나 전체를 하이라이트하는 것뿐 아니라 연속적인 통증 범위를 칠하는 것이다.

- 화면 brush를 표면 샘플로 변환하고 시각 mask/overlay와 의미 이벤트를 별도로 관리한다.
- 인접 손가락이나 겹친 팔/몸통 사이로 Euclidean 반경이 넘어가지 않도록 표면 연결성/지역 경계를 사용한다.
- sample 수·빈도·payload 크기를 제한하고 pointer-up에 최종 결과를 확정한다. 압력과 통증 강도는 별개다.
- centroid/반경/광선 hit 비율은 근사치다. 실제 환자의 면적·밀리미터 깊이로 표시하지 않는다.
- 모델 버전·LOD가 바뀌면 canonical surface map 또는 검증된 correspondence로 이동한다.
- 대응표가 없으면 원본 버전으로 표시하거나 부위 수준으로만 복원하고 정밀도 저하를 알린다. 조용히 다른 삼각형에 복원하지 않는다.
- undo/redo, 여러 통증 부위, 지우개, 재편집, 저장 실패 후 재시도, 모델 전환을 설계한다.

## 5. 저장/API/개인정보

- ADR-011에 맞춰 PostgreSQL을 정본으로 하며 기존 인증된 건강기록 API를 확장한다.
- 가족/profile 권한은 서버에서 확정한다. payload profileId나 LLM이 지정한 ID를 신뢰하지 않는다.
- JSONB 이벤트와 필요한 조회 인덱스/정규화 테이블 중 실제 쿼리 요구를 비교하고 마이그레이션을 설계한다.
- 기존 bodyArea/intensity/sensation/onsetAt/aggravatingFactors/note 기록은 계속 읽고 쓸 수 있어야 한다.
- relievingFactors와 운동 종류·전후 시각·강도·완화 지속시간 등은 사용자 입력 및 해석에 실제 연결될 때 추가한다.
- 유한 좌표, 허용 반경, enum, 샘플 상한, unknown ID, atlas 불일치, 본문 크기를 검증한다.
- idempotency 범위는 계정/프로필을 고려하고 재전송 충돌과 버전 충돌을 처리한다.
- schema/OpenAPI와 TS의 단일 진실 원천을 정한다. 프런트/파이썬 독립 수동 복제로 판단 로직을 늘리지 않는다.
- 실제 건강 데이터/비밀번호/키/프롬프트를 로그·APM·테스트 fixture에 넣지 않는다. `.env`, pem/key 파일을 열지 않는다.
- 외부 AI 전송 범위·목적·동의 정책을 기존 서비스와 맞추고 식별정보를 최소화한다.

## 6. LLM 해석 흐름과 안전성

GLB 전체나 스크린샷을 기본 전송하지 않는다. 서버가 검증한 의미 JSON + 해당 사용자에게 허용된 일기 + 결정적으로 계산한 시계열 요약을 제공한다.

1. 인증 범위에서 관련 기록을 조회한다. LLM 임의 SQL/임의 profile 조회 금지.
2. 7/30/90일 등 명시적 창에서 통증 빈도·양상·운동 전후 관찰을 계산한다. 실제 자료량에 맞춰 창을 선택한다.
3. 결측, 시간대, 중복, 운동 종류, 휴식/약물/수면 등의 교란을 표시한다. 운동 후 호전만으로 원인·치료 효과를 확정하지 않는다.
4. 해부학 관계 지식이 필요하면 출처 있는 registry/관계 자료를 조회한다. 단순 근접도를 신경 지배나 연관통으로 치환하지 않는다.
5. 출력은 관찰 사실(기록 ID), 가능한 해석, 반대 근거, 부족한 정보, 확인 질문, 한계를 분리한다.
6. 위험 신호 대응은 기존 안전 경로와 통합하고 임상 내용은 신뢰할 수 있는 최신 1차 지침 확인·전문가 검토를 거친다. 이 문서가 의료 규칙의 출처는 아니다.

임의 확률 수치나 확정 진단 금지. LLM이 mesh 의미·진단을 창작하지 않도록 ID whitelist와 구조화 출력 검증을 둔다. 일기 속 명령문은 데이터로 취급한다. LLM 장애 시 저장은 성공할 수 있어야 하고 해석만 재시도 가능하게 한다. RAG·지식그래프는 필요성과 평가 이득이 확인될 때 단계적으로 추가한다.

## 7. 구현 순서와 산출물

### E1. registry와 계약 고정

자산 조사 → 개념 매핑 누락/중복 보고 → 버전 schema → 유효/무효 fixture → TS/API 계약 테스트. 46/48번에 공유할 최소 계약을 먼저 고정한다. 실제 없는 근막/연골/치아 데이터를 있다고 가정하지 않는다.

### E2. 단일 탭 수직 흐름

현재 picker → canonical event → 통증 기록 저장 → 새로고침 후 같은 부위 복원. 권한/미매핑/중복/구버전 오류까지 테스트한다.

### E3. 연속 칠하기·복수 부위

brush 상태/표면 mask/이벤트 집계/지우개/undo → 저장 → 복원. 모델 교체와 LOD correspondence 검증. 48번의 깊이 후보는 별도 목록으로 연결한다.

### E4. 서버 시계열·해석

결정적 통계 테스트 → 허용된 컨텍스트 조립 → 구조화 LLM 출력 → 안전 실패 UI. 기록 저장과 추론 지연을 분리한다.

### E5. 통합·평가

46번 병합 renderer와 48번 모든 입력 방식으로 같은 의미 이벤트가 나오는지 확인한다. mock 통과와 실제 통합 통과를 구분한다.

## 8. 평가 게이트

- [ ] 회전·확대·비균일 스케일·좌우·남녀 atlas 테스트에서 의미 ID 오염 0건.
- [ ] topology 불일치가 감지되고 잘못된 정밀 복원을 하지 않는다.
- [ ] 동일 event 재전송으로 중복 기록이 생기지 않는다.
- [ ] 다른 계정/허용되지 않은 가족 profile 접근 차단.
- [ ] 기존 통증 기록 읽기/쓰기 회귀 0건.
- [ ] 표면 보고/깊이 후보/확정 선택/모델 가설이 끝까지 분리된다.
- [ ] 합성 평가셋: 자료 부족, 서로 모순된 일기, 운동 후 호전/악화, 무관한 운동, 약물 동시 변경, 시간대 경계, prompt injection, LLM 장애.
- [ ] 출력 근거 ID 유효율, 근거 없는 단정 건수, 누락 질문, 위험 시나리오 대응을 항목별 보고한다. 전문 검토 없는 임상 정확도 주장을 하지 않는다.
- [ ] 비용·지연·payload 상한을 측정하고 실제 건강정보 유출이 없다.

평가 fixture는 합성으로 작성하고 정답/허용 대답/금지 대답을 명시한다. 통계 사실은 결정적 정답과 비교하고 임상 가설은 별도 전문가 평가로 분리한다. 목표 기준은 구현 전 합의하고 측정되지 않은 값을 달성으로 보고하지 않는다.

## 9. 다른 브랜치와의 경계·롤백

이 브랜치는 registry/schema/API/저장/서버 해석 정본을 소유한다. 46번은 renderer와 자산 최적화, 48번은 depth/precision picker와 UI를 소유한다. 계약 변경은 버전과 fixture로 공유한다. Human Atlas의 partIndex는 render용 키일 뿐 이 이벤트의 영구 ID를 대신하지 않는다.

새 기능 플래그를 끄면 기존 통증 일기 흐름이 작동하게 한다. additive migration 우선, 기존 레코드 삭제 금지. 새 형식 데이터가 생성된 뒤 롤백할 때도 읽기 호환성을 유지한다. 다른 작업 폴더 수정, 커밋·병합·푸시·배포는 별도 요청 없이 하지 않는다.

## 10. 검증·최종 보고

docs/34 순서로 ruff check/format check → mypy app → `pytest app/tests/model -q` → app/tests(DB) → alembic check → frontend lint/typecheck/test/build/e2e를 수행한다. DB는 공유 환경인지 확인하고 다른 작업 테스트와 충돌시키지 않는다. 순수 기하/schema 테스트가 DB 없이 실행되게 한다.

최종 산출물: schema/registry/fixture, 코드·migration, 테스트, 익명화된 전후 사례, 평가 원자료, API 예시, 구버전 호환·롤백 절차, 미완료 게이트. 문서만 작성하거나 LLM 답변이 그럴듯하다는 이유로 완료 처리하지 않는다.
