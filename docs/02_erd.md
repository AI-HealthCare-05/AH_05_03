# ERD (Entity Relationship Diagram) — 초안

> 담당: 조현승(주도), 권민재(지원)
> 관련 평가기준: 1-3, 2-3
> 최종 다이어그램은 [dbdiagram.io](https://dbdiagram.io/) 또는 ERDCloud로 작성 후 이 문서 하단에 링크/이미지를 추가한다. 아래는 텍스트 기반 초안으로, `01_requirements.md`의 REQ 항목을 근거로 도출했다.

## 1. 엔티티 목록

| 엔티티 | 설명 | 관련 REQ |
|---|---|---|
| `users` | 회원 정보 | REQ-01 |
| `health_records` | 사용자가 입력(또는 OCR 인식)한 건강/활동 데이터 | REQ-02, REQ-03, REQ-07 |
| `prediction_results` | 예측 모델 실행 결과 이력 | REQ-02, REQ-03 |
| `challenges` | 챌린지 마스터 데이터(걷기/물마시기/운동 등) | REQ-04 |
| `challenge_participations` | 사용자-챌린지 참여 및 일일 인증 기록 | REQ-04 |
| `recommendations` | LLM이 생성한 일일 예방 행동 추천 | REQ-05 |
| `feedback` | 예측/추천 결과에 대한 사용자 피드백 | REQ-06 |
| `notifications` | 알림 발송 이력 (선택 기능) | REQ-08 |

## 2. 주요 테이블 컬럼 (초안)

### users
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | PK, UUID | |
| email | varchar, unique | |
| password_hash | varchar | 소셜 로그인 시 null 허용 |
| name | varchar | |
| birth_date | date | 예측 모델 입력값(연령) 산출용 |
| created_at | timestamp | |

### health_records
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | PK, UUID | |
| user_id | FK → users.id | |
| recorded_at | timestamp | |
| source | enum('manual','survey','ocr') | REQ-07 OCR 입력 구분 |
| systolic_bp / diastolic_bp | int | 혈압 |
| blood_glucose | float | 혈당 |
| bmi | float | |
| steps | int | 활동량 |
| raw_payload | jsonb | 설문형 데이터 등 비정형 값 |

### prediction_results
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | PK, UUID | |
| user_id | FK → users.id | |
| health_record_id | FK → health_records.id | 어떤 입력 기준 예측인지 추적 |
| disease_type | enum('hypertension','diabetes') | |
| risk_score | float | 0~1 |
| model_version | varchar | 3-1 성능검증/실험 추적용 |
| created_at | timestamp | |

### challenges
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | PK, UUID | |
| title | varchar | |
| type | enum('steps','water','exercise', ...) | |
| goal_value | float | 목표치(예: 8000보) |
| duration_days | int | |

### challenge_participations
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | PK, UUID | |
| user_id | FK → users.id | |
| challenge_id | FK → challenges.id | |
| joined_at | timestamp | |
| progress | jsonb | 일자별 인증 기록 |
| status | enum('active','completed','failed') | |

### recommendations
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | PK, UUID | |
| user_id | FK → users.id | |
| content | text | LLM 생성 추천 문구 |
| based_on_health_record_id | FK → health_records.id | |
| created_at | timestamp | |

### feedback
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | PK, UUID | |
| user_id | FK → users.id | |
| target_type | enum('prediction','recommendation') | |
| target_id | UUID | prediction_results.id 또는 recommendations.id |
| is_helpful | boolean | |
| comment | text, nullable | |
| created_at | timestamp | 3-4 재학습 파이프라인의 입력 소스 |

## 3. 관계 (Relationship)

- `users` 1 : N `health_records`
- `users` 1 : N `prediction_results`
- `health_records` 1 : N `prediction_results` (하나의 기록으로 여러 질환 유형 예측 가능)
- `users` N : M `challenges` (through `challenge_participations`)
- `users` 1 : N `recommendations`
- `users` 1 : N `feedback`

## 4. 다음 단계

1. 조현승이 위 초안을 dbdiagram.io로 시각화.
2. 권민재가 `03_api_spec.md` 작성 시 이 스키마를 요청/응답 필드 기준으로 참조.
3. 데이터 마트(집계용 테이블/뷰)는 대시보드 성능(REQ-03, 평가기준 5-1)을 고려해 조현승이 별도 설계.
