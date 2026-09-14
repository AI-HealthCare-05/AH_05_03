---
name: rest-api-design
description: "RESTful API design and refactoring intelligence for backend endpoints. Use this skill when designing, reviewing, creating, or refactoring HTTP APIs, routes, status codes, error handling (RFC 7807 Problem Details), distributed tracing headers (X-Request-ID), and structured logging. Combines Microsoft REST API Guidelines (resource modeling & CRUD) with Zalando RESTful Guidelines (RFC 7807 & MUST/SHOULD strictness)."
---

# rest-api-design

Microsoft REST API Guidelines(자원 모델링·CRUD 뼈대)과 Zalando RESTful Guidelines(IETF RFC 7807 표준 에러·MUST/SHOULD 규칙 엄격성·분산 관측성)을 결합한 **RESTful API 설계 및 검증 엔진**이다.

백엔드 라우터, 엔드포인트, 상태 코드, 에러 응답, 로깅 미들웨어 관련 작업을 수행할 때 이 지침을 단일 진실 원천(SSOT)으로 삼는다.

---

## 1. 핵심 설계 철학 (Core Philosophy)

1. **자원 지향 모델링 (Resource-Oriented)**:
   - URI는 고유한 '명사(Noun/Entity/Collection)'를 가리키며, 행위(Action)를 가리키지 않는다.
   - 행위는 오직 **표준 HTTP 메서드 (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`)**로만 표현한다.
2. **명확한 상태 코드 계약 (Explicit Status Code Contract)**:
   - 성공을 단순히 `200`으로 퉁치지 않고 생성(`201`), 접수(`202`), 삭제/빈응답(`204`)을 칼같이 구분한다.
3. **국제 표준 에러 포맷 (RFC 7807 Problem Details)**:
   - 임의의 문자열 딕셔너리(`{"detail": "..."}`) 대신 `application/problem+json` 규격을 필수 준수한다.
4. **관측성 연계 (Distributed Tracing & Structured Logging)**:
   - 모든 API 요청/응답은 `X-Request-ID`를 매개로 추적 가능해야 하며, 로그 시스템과 1:1로 결합된다.

---

## 2. 엄격한 설계 규칙 (`[MUST]` / `[SHOULD]`)

### [MUST] Rule 101: 컬렉션은 소문자 복수형 명사와 케밥 케이스를 사용한다
* **Good**: `/api/v1/users`, `/api/v1/health-records`, `/api/v1/households/{household_id}/members`
* **Bad**: `/api/v1/user`, `/api/v1/healthRecord`, `/api/v1/household_list`

### [MUST] Rule 102: URI 경로에 동사(Verb)를 절대 포함하지 않는다
* **Bad (RPC Style)**:
  - `POST /api/v1/auth/signup`
  - `POST /api/v1/predictions/risk`
  - `POST /api/v1/challenges/checks`
  - `POST /api/v1/profiles/sync`
  - `GET  /api/v1/records/get-all`
  - `POST /api/v1/members/delete`
* **Good (RESTful Resource Style)**:
  - `POST   /api/v1/users` (회원 가입/생성)
  - `POST   /api/v1/assessments` (평가 리소스 생성/요청)
  - `POST   /api/v1/challenges/{challenge_id}/verifications` (인증 생성)
  - `PUT    /api/v1/profiles` (프로필 전체 교체/동기화)
  - `GET    /api/v1/records` (목록 조회)
  - `DELETE /api/v1/members/{member_id}` (단건 삭제)

> **예외 (커스텀 액션 - AIP/Google Cloud 스타일)**:
> 모델 재학습, 비밀번호 초기화 메일 발송 등 특정 리소스 생성으로 환원하기 어려운 컨트롤러성 액션은 `:action` 문법을 서브 리소스 뒤에 붙인다.
> 예: `POST /api/v1/models/lifestyle:retrain`, `POST /api/v1/users/{id}:reset-password`

### [MUST] Rule 103: HTTP 메서드 시맨틱과 멱등성을 지킨다
| 메서드 | 의미 | 멱등성(Idempotent) | 안전성(Safe) | 요청 본문 | 기본 성공 상태 코드 |
|---|---|---|---|---|---|
| `GET` | 리소스/컬렉션 조회 | Yes | Yes | 없음 | `200 OK` |
| `POST` | 하위 리소스 생성 / 연산 | No | No | 필수 | `201 Created` / `202 Accepted` |
| `PUT` | 리소스 전체 덮어쓰기 | Yes | No | 필수 | `200 OK` |
| `PATCH`| 리소스 부분 수정 | No (일반적으로) | No | 필수 | `200 OK` |
| `DELETE`| 리소스 삭제 | Yes | No | 없음 | `204 No Content` |

### [MUST] Rule 104: 생성(`201`) 성공 시 반드시 `Location` 헤더를 반환한다
* 신규 자원을 생성한 경우 응답 헤더에 새로 생성된 리소스의 절대/상대 경로를 포함한다:
  ```http
  HTTP/1.1 201 Created
  Location: /api/v1/health-records/rec-789a12c
  Content-Type: application/json
  ```

### [MUST] Rule 105: 비동기 백그라운드 작업은 `202 Accepted`를 반환한다
* 즉시 완료되지 않는 ML 예측 채점, OCR 배치, 보고서 생성 등은 `202 Accepted`와 함께 작업 상태를 조회할 수 있는 엔드포인트 정보를 반환한다:
  ```json
  {
    "job_id": "job-f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
    "status": "pending",
    "status_url": "/api/v1/jobs/job-f81d4fae-7dec-11d0-a765-00a0c91e6bf6"
  }
  ```

### [MUST] Rule 106: 에러 응답은 국제 표준 RFC 7807 (`application/problem+json`)을 준수한다
모든 `4xx`, `5xx` 에러는 반드시 다음 6개 핵심 필드로 구성된 구조를 반환한다:

```json
{
  "type": "https://api.ieobom.com/errors/invalid-biometrics",
  "title": "Invalid Biometrics Range",
  "status": 422,
  "detail": "수축기 혈압(sbp) 350은 허용 범위(40~300 mmHg)를 초과했습니다.",
  "instance": "/api/v1/predictions/assessments",
  "request_id": "req-9b1deb4d-3b47-4f21-8285-00a0c91e6bf6"
}
```

* 필드 명세:
  - `type` (URI, 필수): 에러 유형을 고유하게 식별하는 문서 URI (영문 케밥 케이스)
  - `title` (string, 필수): 사람이 읽을 수 있는 짧은 요약 (HTTP 상태 코드 기본 문구 또는 에러 분류)
  - `status` (int, 필수): HTTP 상태 코드와 동일한 정수값
  - `detail` (string, 선택/권장): 구체적인 오류 원인 및 사용자 친화적 메시지
  - `instance` (string, 필수): 오류가 발생한 요청 엔드포인트 URI
  - `request_id` (string, 필수): 로그 시스템과 대조할 수 있는 고유 상관 ID

### [MUST] Rule 107: `X-Request-ID` 상관 ID를 전 계층에 전파한다
1. 클라이언트(프런트엔드)가 `X-Request-ID`를 전달하면 이를 그대로 채택한다.
2. 전달되지 않았을 경우 FastAPI 미들웨어에서 `req-<uuid4>`를 즉시 생성한다.
3. 모든 HTTP 응답 헤더에 `X-Request-ID`를 반드시 실어 반환한다.
4. Redis 큐/Celery 작업 발행 시 페이로드 메타데이터에 `request_id`를 실어 워커 로그까지 동일한 ID로 추적한다.

### [MUST] Rule 108: 의료 개인정보(PHI)는 로그 본문에 평문 기록을 금지한다
* 환자 실명, 주민번호, 전화번호는 절대 로그에 남기지 않는다.
* 수축기/이완기 혈압, 공복혈당, 콜레스테롤 등의 상세 임상 데이터는 `body` 전체를 로깅하지 않고 `{ "user_id": 123, "assessment_id": 456 }` 형태로 식별자만 구조화 로그에 남긴다.

### [SHOULD] Rule 109: 컬렉션 조회 시 표준 페이징 및 필터링을 제공한다
* 쿼리 파라미터는 `limit`과 `offset` (또는 `cursor`)를 기본으로 사용한다:
  - `GET /api/v1/records?limit=20&offset=0&sort=-created_at`
* 반환 구조:
  ```json
  {
    "items": [...],
    "total": 142,
    "limit": 20,
    "offset": 0
  }
  ```

---

## 3. FastAPI 표준 구현 템플릿

### A. RFC 7807 Problem Detail 모델 (`app/dtos/problem_detail.py`)

```python
from pydantic import BaseModel, Field


class ProblemDetail(BaseModel):
    """RFC 7807 Problem Details for HTTP APIs (application/problem+json)."""
    type: str = Field(
        ...,
        description="오류 유형을 식별하는 URI",
        example="https://api.ieobom.com/errors/invalid-parameter",
    )
    title: str = Field(..., description="오류 요약", example="Invalid Parameter")
    status: int = Field(..., description="HTTP 상태 코드", example=422)
    detail: str = Field(..., description="상세 원인 설명", example="요청 값이 유효하지 않습니다.")
    instance: str = Field(..., description="요청 발생 엔드포인트", example="/api/v1/assessments")
    request_id: str = Field(..., description="요청 추적 ID", example="req-f81d4fae-7dec-11d0")
```

### B. 표준 엔드포인트 정의 패턴 (상태 코드 & 헤더 계약)

```python
from fastapi import APIRouter, Header, Response, status
from app.dtos.assessment import AssessmentCreateRequest, AssessmentResponse

router = APIRouter(prefix="/api/v1/assessments", tags=["Assessments"])


# 1. 단건 생성: 201 Created + Location 헤더
@router.post(
    "",
    response_model=AssessmentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="만성질환 평가 생성",
)
async def create_assessment(
    payload: AssessmentCreateRequest,
    response: Response,
    x_request_id: str | None = Header(None, alias="X-Request-ID"),
) -> AssessmentResponse:
    result = await assessment_service.evaluate(payload)
    # RFC 규격: 신규 생성 리소스 URI 명시
    response.headers["Location"] = f"/api/v1/assessments/{result.assessment_id}"
    return result


# 2. 단건 삭제: 204 No Content
@router.delete(
    "/{assessment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="만성질환 평가 삭제",
)
async def delete_assessment(assessment_id: str) -> None:
    await assessment_service.delete(assessment_id)
    return None
```

---

## 4. 기존 이어봄 엔드포인트 리팩토링 매핑 가이드 (AS-IS → TO-BE)

| 현재 비표준 엔드포인트 (AS-IS) | 권장 RESTful 엔드포인트 (TO-BE) | 메서드 | 성공 코드 | 이유 |
|---|---|---|---|---|
| `/auth/signup` | `/api/v1/users` | `POST` | `201` | 계정 생성은 `users` 컬렉션에 새 자원을 등록하는 행위 |
| `/auth/login` | `/api/v1/auth/tokens` | `POST` | `200` | 로그인은 인증 토큰(자원)을 발급받는 행위 |
| `/predictions/risk` | `/api/v1/assessments` | `POST` | `201` 또는 `202` | 예측 모델을 돌려 새로운 '위험도 평가서' 자원을 생성 |
| `/challenges/checks` | `/api/v1/challenges/{id}/verifications` | `POST` | `201` | 챌린지 하위에 인증 내역 자원 생성 |
| `/profiles/sync` | `/api/v1/profiles` | `PUT` 또는 `PATCH` | `200` | 프로필 동기화는 프로필 자원의 갱신 |
| `/households` & `/account` 혼재 | `/api/v1/households`, `/api/v1/users/me` | REST 규격 | 표준 | 단수/복수 통일 및 나(me)에 대한 리소스 정규화 |

---

## 5. AI 자체 검증 체크리스트 (Self-Check Checklist)

AI는 API 관련 코드 생성 또는 리팩토링 완료 후 아래 6가지 항목을 반드시 자가 점검한다:

- [ ] **1. URI 검증**: 경로에 동사(`get`, `create`, `update`, `delete`, `run`)가 없고 복수형 명사 컬렉션을 사용하는가?
- [ ] **2. 상태 코드 검증**:
  - 생성이면 `201`과 `Location` 헤더가 있는가?
  - 비동기 잡이면 `202`와 상태 확인 링크가 있는가?
  - 삭제나 내용 없는 응답은 `204 No Content`인가?
- [ ] **3. 에러 포맷 검증**: 에러 발생 시 RFC 7807 포맷(`type`, `title`, `status`, `detail`, `instance`, `request_id`)을 따르는가?
- [ ] **4. 로깅 & 추적 검증**: 응답 헤더 및 로그 컨텍스트에 `X-Request-ID`가 누락 없이 연결되는가?
- [ ] **5. 개인정보(PHI) 보호**: 로그 본문에 환자 실명, 민감 임상 수치가 평문으로 찍히지 않는가?
- [ ] **6. 린트 & 타입**: `uv run ruff check .` 및 `uv run mypy app`을 통과하는가?
