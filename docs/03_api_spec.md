# API 명세서 (초안)

> 담당: 권민재(주도), 정다원(보조)
> 관련 평가기준: 1-3, 5-2(HTTP Method 분리), 5-4(인증/인가)
> 개발 진행 중에는 FastAPI가 자동 생성하는 Swagger UI(`/docs`)를 실제 명세로 활용하고, 이 문서는 설계 단계의 기준선 역할을 한다.

## 1. 공통 규칙

- Base URL: `/api/v1`
- 인증: `Authorization: Bearer <access_token>` (REQ-01, REQ-10 / 평가기준 5-4)
- 응답 포맷: `{ "data": ..., "message": "...", "success": true }`
- 에러 포맷: `{ "error_code": "...", "message": "...", "success": false }` + 구체적 상태 코드(400/401/403/404/409/500)
- 네이밍: 요청/응답 필드는 snake_case로 통일 (평가기준 5-2 대비 일관성 확보)

## 2. 엔드포인트 목록 (도메인별)

### 인증 (REQ-01)
| Method | Endpoint | 설명 | 인증 필요 |
|---|---|---|---|
| POST | `/auth/signup` | 이메일 회원가입 | N |
| POST | `/auth/login` | 로그인, JWT 발급 | N |
| POST | `/auth/refresh` | Access Token 재발급 | N (Refresh Token) |
| POST | `/auth/logout` | 로그아웃(토큰 무효화) | Y |

### 건강 데이터 (REQ-02, REQ-03, REQ-07)
| Method | Endpoint | 설명 | 인증 필요 |
|---|---|---|---|
| POST | `/health-records` | 건강 데이터 수동 입력 | Y |
| POST | `/health-records/ocr` | 건강검진 결과지 업로드 → OCR 추출 → 자동 입력 | Y |
| GET | `/health-records` | 내 건강 데이터 이력 조회 (기간 필터) | Y |
| GET | `/health-records/{id}` | 단건 조회 | Y |

### 예측 (REQ-02, REQ-03)
| Method | Endpoint | 설명 | 인증 필요 |
|---|---|---|---|
| POST | `/predictions` | 최신 건강 데이터 기반 예측 요청 (비동기 접수, Redis Stream 등록) | Y |
| GET | `/predictions/{id}` | 예측 결과 조회 (진행중/완료 상태 포함) | Y |
| GET | `/predictions/stream` | SSE — 예측 완료 실시간 알림 | Y |

### 대시보드 (REQ-03)
| Method | Endpoint | 설명 | 인증 필요 |
|---|---|---|---|
| GET | `/dashboard/summary` | 최근 예측 확률, 변화 추이 요약 | Y |
| GET | `/dashboard/trend?range=7d\|30d\|all` | 기간별 추이 그래프용 시계열 데이터 | Y |

### 챌린지 (REQ-04)
| Method | Endpoint | 설명 | 인증 필요 |
|---|---|---|---|
| GET | `/challenges` | 챌린지 목록 | Y |
| POST | `/challenges/{id}/join` | 챌린지 참여 신청 | Y |
| POST | `/challenges/{id}/check-in` | 일일 인증 기록 | Y |
| GET | `/challenges/my` | 내 참여 챌린지 진행률 | Y |

### 추천 (REQ-05, 선택)
| Method | Endpoint | 설명 | 인증 필요 |
|---|---|---|---|
| GET | `/recommendations/today` | 오늘의 LLM 예방 행동 추천 조회(없으면 생성) | Y |

### 피드백 (REQ-06)
| Method | Endpoint | 설명 | 인증 필요 |
|---|---|---|---|
| POST | `/feedback` | 예측/추천 결과에 대한 피드백 등록 | Y |

## 3. 예시 상세 명세 — `POST /predictions`

| 항목 | 내용 |
|---|---|
| 설명 | 최신 건강 데이터를 기준으로 만성질환(고혈압/당뇨) 발병 가능성 예측을 요청한다. 무거운 연산은 AI Worker가 비동기 처리하며, 이 API는 접수만 담당한다. |
| Method / URL | `POST /api/v1/predictions` |
| 인증 | 필요 |
| Request Body | `{ "health_record_id": "uuid", "disease_types": ["hypertension", "diabetes"] }` |
| Response (202) | `{ "data": { "prediction_id": "uuid", "status": "pending" }, "success": true }` |
| 오류 | 400 `HEALTH_RECORD_NOT_FOUND` — 존재하지 않는 health_record_id / 401 미인증 |

> 나머지 엔드포인트도 개발 착수 전 위와 같은 형식(Method/URL/인증/Request/Response/오류)으로 상세화한다. Sprint 2 시작(8/17) 전까지 전체 상세화를 완료 목표로 한다.
