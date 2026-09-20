# 이어봄 에이전트 도입 기준안

- 상태: 구현 전 기준안 (2026-09-20)
- 결정: [ADR-0015](adr/0015-bounded-agent-on-policy-and-evidence.md)
- 관련: [ADR-0014](adr/0014-document-vision-not-ocr.md), [ADR-0011](adr/0011-postgresql-health-data-and-server-ai.md), [ADR-0012](adr/0012-delegated-member-pin-not-vault-dek.md), [ADR-0013](adr/0013-privacy-self-determination-and-civil-majority.md), [00_terminology.md](00_terminology.md), [08_account_profile_policy.md](08_account_profile_policy.md), [55_tool_registry.md](55_tool_registry.md)

현재 제품은 에이전트 루프가 아니다. 문서 Vision은 한 번 판독하는 파이프라인이고, 챗봇은 서버가 필요한 의료 근거를 먼저 준비하고 허용 도구를 **한 차례** 고르는 제한형 tool calling이다. 건강정보 정본은 PostgreSQL이다(ADR-0011). 이 문서는 그 위에 bounded 에이전트를 올릴 때의 개발 기준이다.

한 줄:

> 이어봄 에이전트는 기존 의료 근거·권한·문서 Vision 파이프라인을 대체하지 않는다. 서버가 필수 근거와 허용 도구를 먼저 확정하고, 에이전트는 ADR-0011·0012·0013이 잠근 범위 안에서 최대 N번 다음 행동을 선택한다. 건강정보 변경은 초안과 사용자 승인을 거치며, 문서 Vision은 로컬 비식별화가 준비되기 전까지 대화형 도구로 개방하지 않는다. Langfuse는 먼저 메타데이터만 수집하고, 모델 공급자 마스킹과 관찰 데이터 마스킹을 별도로 적용한다.

## 1. 구현 순서

권한 게이트가 러너보다 앞이다. 읽기 전용이라도 가족 건강기록은 민감정보다.

1. Langfuse `metadata_only`와 이중 마스킹 (모델 공급자 / 관찰 데이터)
2. 기존 도구 목록·입출력 계약 정리 (없는 도구를 가정하지 않는다) — [55](55_tool_registry.md)
3. 도구별 capability·프로필 범위 정책 (PIN 행위자, 역할, 미성년·성년 상태 포함)
4. 읽기 전용 bounded agent runner
5. 합성 시나리오 평가
6. 사용자 승인형 쓰기
7. 문서 비식별화 (픽셀 마스킹)
8. 확정된 Vision 결과만 에이전트 도구로 제한 조회

러너가 처음 생기는 시점부터 세션 시작과 **각 도구 실행 직전**에 다시 검사한다. 위임 PIN·역할은 실행 중 철회될 수 있다(ADR-0012).

```python
allowed_tools = policy.allowed_tools(
    account_id=account.id,
    active_profile_id=profile.id,
    household_id=household.id,
    session_type=session.type,
    actor_role=pin_session.role,
    capabilities=pin_session.capabilities,
    minor_policy_state=profile.minor_policy_state,
)
```

## 2. 질문 분류와 필수 근거

```text
정책 분류기
├─ 의료적 주장·건강기록 기반 답변
│   └─ 서버가 필수 근거를 먼저 준비. 에이전트는 생략 불가
├─ 시설·약품·날씨 등 추가 행동
│   └─ 에이전트가 필요 여부 선택
└─ 일상 대화·사용법
    └─ 기록 조회 없이 답변
```

분류가 애매하면 일상 대화로 보내지 않는다.

```text
의료 질문인지 확실하지 않음
→ 의료 질문으로 취급
→ 필요한 근거를 준비하거나 답변 범위를 제한
```

예시 과제 (한 번짜리 tool calling과 구분되는 최소 에이전트 과제):

```text
사용자: 최근 석 달 혈압이 높았던 날이 얼마나 되는지 보고, 필요하면 가까운 병원도 알려줘.

1. 서버가 프로필 권한과 혈압 기록 범위를 확인
2. 필수 기록 조회 및 초과 일수 계산
3. 에이전트가 결과를 관찰
4. 진료기관 검색이 필요한지 결정
5. 위치가 없으면 사용자에게 지역 질문
6. 시설 검색
7. 근거와 함께 최종 답변
```

## 3. 권한은 도구와 결과 양쪽

`allowed_tools()`만으로는 부족하다. ADR-0012의 capability와 ADR-0013의 연령 이벤트를 결과에도 적용한다.

```text
1차: 이 도구를 사용할 수 있는가?
2차: 어느 프로필·기간·필드까지 읽을 수 있는가?
3차: 반환 결과에 불필요한 다른 가족 정보가 섞이지 않았는가?
```

`query_health_records`가 허용돼도 다른 가족이나 전체 기간의 기록을 반환하지 않는다. `self_only`·`restricted`·성년 대기 프로필은 더 좁다. 도구 래퍼는 호출 전 인가와 호출 후 결과 필터를 모두 통과해야 한다.

## 4. 승인형 쓰기

5단계 이전에는 건강기록·통증기록을 에이전트가 직접 쓰지 않는다. 붙일 때 승인 토큰은 **사용자가 본 초안**에 묶는다. PIN만으로 쓰기를 승인하지 않는다(ADR-0012).

```json
{
  "tool": "create_health_record",
  "profile_id": "가명 또는 내부 식별자",
  "payload_hash": "승인 화면에 보여준 내용의 해시",
  "expires_at": "짧은 만료시간",
  "single_use": true
}
```

저장 직전 내용·프로필·권한을 재검증한다. 해시가 다르면 거부한다. 멱등 저장만 허용한다. 삭제·공유 확대·성년 전환은 제외하거나 ADR-0013의 재인증을 요구한다.

## 5. 문서 Vision과 에이전트

제품 판독 엔진은 전용 OCR이 아니라 멀티모달 LLM Vision이다 ([ADR-0014](adr/0014-document-vision-not-ocr.md)). 코드 식별자 `ocr`는 구 이름이다.

```text
Gemini Vision        유연하게 읽기 (대화 밖 업로드 화면)
ocr_measurements     검사 항목·단위 검증
사용자               최종 확인
Agent                확정된 기간·필드만 조회한 뒤 다음 행동 선택
```

초기 흐름:

```text
문서 업로드 화면
→ Vision 분석 (비식별 완료 전: 합성·비식별 문서만)
→ 사용자 수정·확정
→ 최소 구조화 결과 저장 (서버 정본, ADR-0011)
→ 이후 에이전트가 확정된 결과만 제한 조회
```

에이전트에 넘기는 확정 결과는 질문에 필요한 기간과 필드만 포함한다. 환자 이름, 병원번호, 문서 원문, 전체 검사표는 넣지 않는다.

```json
{
  "exam_month": "2026-09",
  "measurements": [
    {
      "code": "fasting_glucose",
      "value": 105,
      "unit": "mg/dL"
    }
  ],
  "source": "user_confirmed_ocr"
}
```

`document_id`만 도구에 넘기는 것은 개인정보 해결이 아니다. 백엔드가 그 ID로 원본을 Vision에 보내면 동일하다.

### 5.1 픽셀 마스킹 위치

로컬 비식별화가 끝나기 전에는 합성·비식별 문서만 외부 Vision에 보낸다.

| 방식 | 판정 |
|---|---|
| 브라우저·사용자 기기에서 마스킹한 뒤 업로드 | 채택 목표. 가장 안전 |
| 이어봄 서버가 원본을 받은 직후 마스킹하고, 마스킹 사본만 외부 Vision에 전송 | 차선. 원본은 서버에만 짧게 머물고 외부로 나가지 않아야 함 |
| Gemini가 문서를 받은 뒤 프롬프트로 개인정보를 무시하라고 요청 | 금지. 원본이 이미 외부 공급자에게 전달됨 |

마스킹 파이프라인(문서 종류 판별 → 식별 영역 탐지 → 픽셀 마스킹 → 필요 영역만 유지 → 미리보기·동의 → 원본/사본 수명 분리)은 7단계 작업이다. 그 전에는 8단계를 열지 않는다.

## 6. Langfuse

에이전트 런타임에는 확정 수치가 필요할 수 있다. 프로덕션 Langfuse에는 그 값을 남기지 않는다. ADR-0011의 “프롬프트·건강정보 원문을 분석 도구에 남기지 않는다”와 같다.

런타임 (에이전트 컨텍스트, 사용자 답변용):

```json
{
  "code": "fasting_glucose",
  "value": 105,
  "unit": "mg/dL"
}
```

프로덕션 관찰:

```json
{
  "measurement_codes": ["fasting_glucose"],
  "measurement_count": 1,
  "source": "user_confirmed_ocr",
  "exact_values_logged": false
}
```

프로덕션과 합성 환경 모두 Langfuse에는 metadata만 남긴다. 정확한 수치는 런타임 답변 근거로만 쓰고 trace에는 올리지 않는다. Vision 판독·챗봇 trace는 분리한다. 사용자·세션은 HMAC 가명이다. 공급자 경로의 문자열 PII 치환과 관찰 allowlist는 별개이며, 문서 픽셀 마스킹(#210)을 대체하지 않는다.

## 7. 합성 평가 (4단계)

최소 과제:

- 기간별 혈압 확인 후 필요하면 병원 검색
- 복용 약품 상호작용 확인 후 공식 근거 설명
- 증상과 최근 기록을 확인하고 부족한 정보를 사용자에게 질문

평가 축:

- 적절한 도구 선택
- 불필요한 도구 호출
- 권한 우회 시도 차단 (도구·결과 층, 다른 가족, `self_only`, 성년 대기)
- 애매한 질문을 일상 대화로 잘못 분류하지 않는지
- 근거 누락
- 반복 루프
- 비용·지연
- 긴급 증상 처리
- 마스킹 누락 (모델 공급자 / Langfuse)
