# API 및 로컬 기능 계약

> 상태: 상세 목표 계약 1.0 초안
>
> 서버 계약 원본: [OpenAPI 3.1](api/openapi.yaml)
>
> 로컬 계약 원본: [브라우저 로컬 데이터 계약](10_local_data_contract.md)
>
> 데이터 모델: [서버·로컬 ERD](02_erd.md), [PostgreSQL DDL](database/0002_service_domain.sql)
> 아키텍처 결정: [ADR-001](adr/0001-web-local-first-architecture.md), [ADR-002](adr/0002-separate-server-api-and-local-domain-contract.md), [ADR-003](adr/0003-web-authentication-token-transport.md), [ADR-004](adr/0004-family-invitation-state-and-redis-boundary.md), [ADR-006](adr/0006-lifecycle-scoped-profile-reference.md), [ADR-011](adr/0011-postgresql-health-data-and-server-ai.md)
>
> 위임 PIN API는 [ADR-012](adr/0012-delegated-member-pin-not-vault-dek.md)(**승인**) · [#191](https://github.com/AI-HealthCare-05/AH_05_03/issues/191). 감사·비상 철회는 [#195](https://github.com/AI-HealthCare-05/AH_05_03/issues/195). 경로는 아래 가정 API 표와 §4.4에 적었다.

## 0. 빠른 보기

이 절은 탐색을 위한 요약이다. 기능의 삭제 여부나 상세 계약을 결정하지 않는다. 구현 우선순위의 원본은 [요구사항](01_requirements.md)과 [로드맵](07_roadmap.md), 서버 계약의 원본은 [OpenAPI 3.1](api/openapi.yaml), 로컬 계약의 원본은 [브라우저 로컬 데이터 계약](10_local_data_contract.md)이다.

| 우선순위 | 기능 영역 | 처리 위치 | 상세 기준 |
|---:|---|---|---|
| 1 | 서비스 계정 가입·로그인, 구독·라이선스 | 서버 API | OpenAPI |
| 1 | 가족 구성원 로컬 프로필, 건강기록 | 브라우저 로컬 | 로컬 데이터 계약 |
| 1 | 암호화 백업·복구 | 브라우저와 사용자 파일 | 로컬 데이터 계약 §8 |
| 2 | 가족 초대·수락, 기존 로컬 프로필 연결 | 서버 API와 로컬 보상 처리 | OpenAPI·이 문서 §5~8 |
| 2 | 중복 프로필 비교·병합·되돌리기 | 브라우저 로컬 | 로컬 데이터 계약 §9 |
| 3 | 구성원별 공유 범위, 암호화 데이터 이전 | 브라우저 로컬 | 요구사항·로컬 데이터 계약 |
| 3 | WebRTC 기기 직접 전송 | 브라우저와 최소 서버 메타데이터 | 기술검증 후 별도 ADR·API 결정 |

2·3순위는 제외 기능이 아니라 후순위 구현 기능이다. 선행조건이 일찍 충족되면 앞당길 수 있으며 최종 요구사항과 와이어프레임 범위에는 유지한다.

### 서버 API 영역 요약

| 영역 | 주요 경로 | 데이터 경계 |
|---|---|---|
| 인증 | `/auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/logout` | 인증과 세션 상태만 처리 |
| 계정 | `/account` | 서비스 계정과 구독 요약만 처리 |
| 구독 | `/subscription`, `/subscription/change` | 구독·라이선스 상태만 처리 |
| 가정 | `/households`, `/households/{id}` | 초대와 연결을 묶는 UUID 컨테이너만 처리 |
| 벽 기기 | `/households/{id}/device-pairings`, `/households/{id}/devices`, `/household-devices` | 페어링 코드·기기 토큰 해시. 건강수치 없음 |
| 가족 초대 | `/family-invitations` 및 상태 전이 경로 | 이메일, 초대 상태, 불투명 프로필 참조값만 처리 |
| 프로필 연결 | `/profile-links` | 서비스 계정과 불투명 로컬 프로필 참조값만 연결 |
| 기기 연결 | 현재 OpenAPI에서 제외 | WebRTC 기술검증 후 채택 여부 결정 |

건강기록, 가족력, 원본 서류, OCR 결과, 예측 결과와 로컬 변경 이력은 위 서버 API에 보내지 않는다.

## 1. 계약 분리

이어봄에는 서로 다른 세 종류의 계약이 있다.

| 계약 | 실행 위치 | 다루는 데이터 | 원본 문서 |
|---|---|---|---|
| Service Metadata REST API | FastAPI·PostgreSQL | 인증, 계정, 구독, 가정, 초대, 불투명 프로필 연결 | `docs/api/openapi.yaml` |
| Local Domain API | 브라우저 TypeScript | 가족 프로필, 건강기록, 가족력, OCR, 예측, 병합, 변경 이력 | `docs/10_local_data_contract.md` |
| Backup Container | 브라우저·사용자 파일 | 허용된 로컬 데이터를 묶은 암호화 백업·이전 파일 | `docs/10_local_data_contract.md` §8 |

건강기록 CRUD를 FastAPI 엔드포인트로 만들지 않는다. 프론트엔드가 로컬 저장소에 접근할 때도 UI 컴포넌트가 IndexedDB나 OPFS를 직접 호출하지 않고 Local Domain API를 사용한다.

## 2. 서버 API 전역 규칙

### 2.1 프로토콜

| 항목 | 값 |
|---|---|
| Base URL | `/api/v1` |
| 명세 | OpenAPI 3.1 |
| 요청·응답 | `application/json; charset=utf-8` |
| 시간 | UTC RFC 3339, 예: `2026-08-18T09:30:00Z` |
| 서버 엔티티 ID | UUID v4 |
| 서비스 계정 ID | UUID v4 |
| 페이지 크기 | 기본 20, 최소 1, 최대 100 |
| 목록 방식 | 불투명 cursor 기반 |
| Access Token | `Authorization: Bearer <JWT>`, 기본 15분 |
| Refresh Token | Secure·HttpOnly·SameSite=Lax 쿠키, 본문 반환 금지 |
| 동시 수정 | `row_version`과 `If-Match: "<version>"` |
| 요청 추적 | 서버가 UUID `request_id`를 생성하고 오류 응답·로그에 기록 |

Pydantic 요청 모델은 `extra="forbid"`로 정의한다. 허용 DTO에 없는 필드는 `422 VALIDATION_ERROR`로 거부한다. 이는 건강정보가 실수로 서버 DTO에 추가되는 것을 막는 첫 번째 경계다.

### 2.2 성공 응답

성공 응답은 공통 봉투를 사용한다. `data`의 구체적인 형태는 엔드포인트별 OpenAPI 스키마로 고정한다.

```json
{
  "data": {
    "id": "82f809e0-c995-4c06-82cc-ec062a88be63",
    "status": "active"
  },
  "message": "요청이 완료되었습니다.",
  "success": true
}
```

### 2.3 오류 응답

```json
{
  "error_code": "PROFILE_ALREADY_LINKED",
  "message": "이 가정에서 이미 다른 로컬 프로필과 연결되어 있습니다.",
  "success": false,
  "details": null
}
```

오류 메시지에는 이메일을 제외한 개인정보, 토큰, 불투명 참조값 전체, 건강정보를 넣지 않는다. 서버 내부 예외 메시지와 SQL을 그대로 반환하지 않는다.

| HTTP | 코드 | 발생 조건 |
|---:|---|---|
| 400 | `INVALID_REQUEST` | JSON은 유효하지만 요청 조합이 잘못됨 |
| 401 | `AUTHENTICATION_REQUIRED` | Access Token 누락·만료·위조 |
| 403 | `PERMISSION_DENIED` | 현재 계정이 작업 대상의 참여자가 아님 |
| 403 | `PROFILE_ACCESS_DENIED` | 가구 멤버이나 대상 프로필 소유권·역할·capability가 부족 (#189) |
| 403 | `HOUSEHOLD_MEMBERSHIP_REQUIRED` | 다른 집 프로필 ID를 쓴 경우 포함 |
| 403 | `LEGAL_GUARDIAN_REQUIRED` | 제품 보호자·마스터만으로 미성년 삭제 검토를 넣을 수 없음 (#194) |
| 403 | `LEGAL_GUARDIAN_UNVERIFIED` | 법정대리인 확인이 없거나 만료됨 (#194) |
| 404 | `RESOURCE_NOT_FOUND` | 대상이 없거나 존재를 숨겨야 함 |
| 409 | `EMAIL_ALREADY_EXISTS` | 대소문자 무시 이메일 중복 |
| 409 | `INVITATION_ALREADY_PENDING` | 같은 가정·이메일·프로필에 대기 초대 존재 |
| 409 | `INVITATION_STATE_CONFLICT` | 대기 상태가 아닌 초대의 수락·거절·취소 |
| 409 | `PROFILE_REFERENCE_ALREADY_USED` | 같은 가정의 과거 초대·연결에서 이미 사용한 참조값 제출 |
| 409 | `PROFILE_ALREADY_LINKED` | 계정이 같은 가정의 다른 프로필에 연결됨 |
| 409 | `PROFILE_REF_ALREADY_CLAIMED` | 같은 프로필 참조값에 다른 계정이 연결됨 |
| 409 | `PROFILE_CLAIM_CONFLICT` | 프로필 ID가 이미 다른 계정에 연결됨. 이름만으로 병합하지 않음 (#192) |
| 409 | `MINOR_DELETION_STATE_CONFLICT` | 미성년 삭제 요청을 지금 상태로 바꿀 수 없음 (#194) |
| 409 | `ADULT_TRANSITION_NOT_DUE` | 성년 전환 시점이 아니거나 본인 재인증이 없음 (ADR-013) |
| 409 | `PROFILE_CLAIM_REQUIRED` | 성년 전환에 본인 프로필 연결이 없음 (ADR-013) |
| 409 | `ACTIVE_MEMBERS_REMAIN` | 다른 활성 구성원이 있는 가정 폐쇄 시도 |
| 410 | `INVITATION_EXPIRED` | 초대 만료 |
| 412 | `VERSION_MISMATCH` | `If-Match`와 `row_version` 불일치 |
| 422 | `VALIDATION_ERROR` | 형식·길이·enum·금지 필드 오류 |
| 422 | `HEALTH_DATA_NOT_ALLOWED` | 서버 금지 데이터가 감지됨 |
| 429 | `RATE_LIMITED` | 인증·초대 등의 속도 제한 초과 |
| 503 | `DEPENDENCY_UNAVAILABLE` | 결제사 등 외부 시스템 일시 실패 |

### 2.4 멱등성

다음 변경 요청은 `Idempotency-Key` 헤더를 필수로 사용한다.

- 가정 생성·폐쇄
- 구독 변경 시작
- 초대 생성·수락·거절·취소
- 프로필 연결·연결 해제
- 계정 폐쇄

규칙:

1. 값은 클라이언트가 생성한 16~72자의 문자열이다.
2. 서버는 `(account_id, operation, idempotency_key)` 단위로 24시간 보존한다.
3. 같은 키와 같은 요청 해시는 이전 상태 코드와 응답을 반환한다.
4. 같은 키에 다른 요청 본문이 오면 `409 IDEMPOTENCY_KEY_REUSED`를 반환한다.
5. 비밀번호, Refresh Token과 건강정보는 멱등성 응답 저장소에 넣지 않는다.

### 2.5 낙관적 잠금

변경 가능한 서버 엔티티는 `row_version bigint`를 가진다. 조회 응답의 `row_version=3`이면 변경 요청에 `If-Match: "3"`을 보낸다. PostgreSQL 갱신은 다음 조건을 사용한다.

```sql
UPDATE family_invitations
SET status = 'accepted', accepted_at = now(), accepted_by_account_id = :account_id
WHERE id = :invitation_id
  AND status = 'pending'
  AND row_version = :expected_version
RETURNING *;
```

반환 행이 없으면 현재 상태를 재조회해 존재하지 않음, 상태 충돌, 버전 충돌을 구분한다.

## 3. 인증·계정 계약

### 3.1 `POST /auth/signup`

요청:

```json
{
  "email": "user@example.com",
  "password": "correct horse battery staple"
}
```

| 필드 | 타입 | 필수 | 제약 |
|---|---|---:|---|
| `email` | email string | Y | 최대 254자, 대소문자 무시 유일 |
| `password` | string | Y | 8~72자, 서버 로그 금지 |

응답은 `201 ServiceAccountResponse`이며 비밀번호 해시를 반환하지 않는다. 서비스 가입에 이름, 가족관계, 성별, 생년, 전화번호와 건강정보를 요구하지 않는다.

### 3.2 `POST /auth/login`

요청은 `email`, `password`이며 응답은 다음과 같다.

```json
{
  "data": {
    "access_token": "eyJ...",
    "token_type": "bearer",
    "expires_in": 900
  },
  "message": "로그인이 완료되었습니다.",
  "success": true
}
```

- 인증 실패는 계정 존재 여부를 구분하지 않고 `401 INVALID_CREDENTIALS`로 통일한다.
- Refresh Token 원문은 PostgreSQL에 저장하지 않고 Redis의 만료되는 allowlist에서 JTI만 추적한다.
- Refresh Token 재사용이 탐지되면 같은 세션 계열을 모두 폐기한다.

### 3.3 `POST /auth/refresh`

Refresh Token은 `Secure·HttpOnly·SameSite=Lax` 쿠키로만 받는다. 성공 시 Access Token과 회전된 Refresh Token 쿠키를 발급한다. 요청에 Origin이 있으면 허용 목록과 정확히 일치해야 하며 `GET` 메서드로 토큰을 갱신하지 않는다.

### 3.4 `GET·DELETE /account`

- `GET`: 계정 ID, 이메일, 상태, 생성 시각과 구독 요약을 반환한다.
- `DELETE`: 서비스 계정을 폐쇄한다(#64). 프로필 휴지통·`가족 공유에서 제외`와 다른 API다. `purge_health_data=true`일 때만 이 계정이 만든 서버 프로필을 지운다.

## 4. 가정·구독 계약

### 4.1 가정 컨테이너

가정은 서버에서 초대와 계정 연결을 묶기 위한 UUID 컨테이너다. 가정 이름, 주소, 가족관계, 구성원 수, 건강정보 요약을 저장하지 않는다.

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/households` | 빈 JSON 객체 | `201 HouseholdResponse` |
| GET | `/households` | 없음 | 참여 가정 배열 |
| GET | `/households/{id}` | 없음 | `200 HouseholdResponse` |
| DELETE | `/households/{id}` | 헤더만 | `204` |
| GET | `/households/{id}/memberships` | 없음 | 가정 멤버십 이력 배열. 계정 UUID를 화면에 직접 노출하지 않고 표시할 `masked_email`과 브라우저 로컬 이름을 찾기 위한 활성 `local_profile_ref`를 포함한다. 프로필 이름과 건강정보는 포함하지 않는다. |
| POST | `/households/{id}/leave` | 없음 | 현재 계정의 `left` 멤버십 |

가정 생성자는 `household_memberships`의 첫 활성 구성원이 된다. 이는 건강정보 접근 권한이나 대표 관리자 역할을 의미하지 않는다.
현재 계정은 자신이 생성하지 않은 가정에서 자진 탈퇴할 수 있으며, 탈퇴 시 자신의 활성 `profile_link`도 함께 해제된다. 가정 생성자는 다른 활성 구성원이 남아 있으면 탈퇴·폐쇄할 수 없다. 마스터가 연결된 성인을 내보내는 경로는 `POST /profiles/{id}/household-unshares`(#192)이며, 계정 삭제 API가 아니다.

### 4.2 공용 벽 기기 (#190)

마스터가 계정 비밀번호로 재인증한 뒤에만 페어링 코드를 만든다. 구성원 PIN으로는 등록하지 않는다. 기기 토큰은 계정 JWT가 아니다. 벽 화면은 가족 개요(이름·관계·역할)만 연다.

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | `/households/{id}/device-pairings` | 마스터 계정 | `201` + `Location`. 코드 원문은 이번만. TTL 5분 |
| GET | `/households/{id}/devices` | 마스터 계정 | 목록. 토큰 원문 없음 |
| DELETE | `/households/{id}/devices/{device_id}` | 마스터 계정 | 본문 `{ "password" }`. `204`. 이미 철회면 멱등 |
| POST | `/household-devices` | 없음(코드) | `201` + `Location`. `household_id` 불일치면 `PAIRING_NOT_FOUND` |
| GET | `/household-devices/me/profiles` | 기기 토큰 | 개요 카드. 철회면 `DEVICE_REVOKED` |
| POST | `/household-devices/me/pin-challenges` | 기기 토큰 | PIN 원문 없음. 미등록 기기 `401`. `204` |
| POST | `/household-devices/me/member-sessions` | 기기 토큰 | PIN 검증. `201` 세션 토큰 이번만. 다른 가구 프로필 `404` |
| POST | `/households/{id}/emergency-device-revocations` | 마스터 계정 | 벽 기기·PIN 세션 철회 + `session_epoch` 증가. 비밀번호 재인증. `201`. 반복 호출 멱등 |
| POST | `/households/{id}/emergency-device-revocations` | 마스터 계정 | 벽 기기·PIN 세션 철회 + `session_epoch` 증가. 비밀번호 재인증. `201`. 반복 호출 멱등 |
| GET | `/households/{id}/audit-events` | 마스터는 가구 전체, 구성원은 자기 행위만. 보존 365일, `limit`≤50. PIN·건강 원문 없음 |
| GET | `/households/{id}/pin-lock-alerts` | 마스터 계정 | 미확인 PIN 잠금 알림. 서버 템플릿, 쿨다운 |
| POST | `/households/{id}/pin-lock-alerts/{alert_id}/acknowledgements` | 마스터 계정 | `201` + `Location` |

가구 ID가 다른 코드는 만료와 구분하지 않고 `PAIRING_NOT_FOUND`다.

### 4.3 구성원 위임 PIN (#191)

원문은 발급 응답에만 있다. 해시는 Argon2id. 마스터(또는 관리형 프로필의 보호자)만 발급·폐기한다. 구성원 PIN으로는 발급·벽 등록을 하지 못한다. 5회 실패 시 `PIN_LOCKED`.

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | `/profiles/{id}/pin-credentials` | 마스터 계정 | `201` + `Location`. 임시 PIN 이번만. 기존 세션 폐기 |
| DELETE | `/profiles/{id}/pin-credentials` | 마스터 계정 | `204`. 세션 폐기 |
| POST | `/profiles/{id}/member-sessions` | 가구 멤버 계정 | `201`. 개인 화면 세션. 다른 집 `404` |
| POST | `/profiles/{id}/pin-replacements` | 가구 멤버 계정 | `204`. 본인 변경. 약한 PIN `PIN_WEAK` |
| POST | `/household-devices/me/pin-replacements` | 기기 토큰 | 벽에서 본인 변경 |

### 4.4 프로필 생명주기 (#193)

숨김(`PATCH status=hidden`)은 소속·기록을 유지한다. 보관·복구·삭제 요청은 아래 명사 경로다. 회원탈퇴는 §3.4 `DELETE /account`.

| Method | Path | 설명 |
|---|---|---|
| GET | `/profiles/{id}/deletion-preview` | 기록 건수·권장 동작(`purge_empty`/`trash`/`forbidden`/`minor_review`)·백업 안내 |
| POST | `/profiles/{id}/archives` | `201` + `Location`. 일반 목록에서 빼고 쓰기를 막음. 복구 가능 |
| POST | `/profiles/{id}/restorations` | `201` + `Location`. 숨김·보관·휴지통 → `active` |
| POST | `/profiles/{id}/deletion-requests` | 빈 `local_slot` `204`. 기록 있으면 `202` + 30일 `purge_after`. 관리형은 이 경로가 아니라 아래 검토 요청 |
| POST | `/profile-purge-jobs` | 마스터 가구의 만료 휴지통만 멱등 파기. `202`. hold는 `skipped_count` |

### 4.6 보호자·법정대리·성인 전환 (#194)

제품 보호자 ≠ 법정대리인. 확인 공급자가 없으면 `pending`만. 체크박스·마스터 클릭으로 `verified`가 되지 않는다. 연령은 `minor_policy` 버전이며 라우터에 숫자를 다시 쓰지 않는다.

| Method | Path | 설명 |
|---|---|---|
| GET | `/profiles/{id}/guardian-links` | 제품 보호자·법정대리 링크 |
| POST | `/profiles/{id}/guardian-links` | 제품 보호자 지정. `201`. `self_attested`여도 `unverified` |
| POST | `/profiles/{id}/legal-guardian-verifications` | 확인 시작. `202` |
| POST | `/legal-guardian-verifications/{id}/refreshes` | 공급자 상태 갱신 |
| POST | `/legal-guardian-verifications/{id}/expirations` | 마스터가 확인 철회. `204` |
| POST | `/profiles/{id}/minor-deletion-requests` | 확인된 법정대리만. `201`. 즉시 파기 아님 |
| POST | `/minor-deletion-requests/{id}/reviews` | 마스터 검토. 승인 시 휴지통 |
| POST | `/minor-deletion-requests/{id}/appeals` | 거절 뒤 이의. `202` |
| POST | `/profiles/{id}/privacy-self-determinations` | 만 14세 자기결정. 본인 claim+비밀번호. 성년 아님. `201` |
| POST | `/profiles/{id}/civil-majority-transitions` | 만 19세 성년. 본인 claim+비밀번호만. PIN·마스터 체크 거절. `201` |
| POST | `/profiles/{id}/guardian-share-reapprovals` | 성년 본인만. 비밀번호 재인증. capability 목록·만료일. 기본은 공용 요약. 빈 목록은 철회. `201` |
| POST | `/profiles/{id}/birth-date-corrections` | 생년월일 정정 감사. 전환·파기 아님. `201` |
| POST | `/ops/civil-majority-invalidations` | 개발·스테이징 break-glass. `OPS_RECOVERY_ENABLED` 필요. `X-Ops-Recovery-Key` + 주장값 `operator_id`·`ticket_ref`. 프로덕션 계열은 라우터 미등록·기동 거부. 시간당 5회(IP+전역). 소켓이 신뢰 프록시일 때만 `X-Forwarded-For`를 보고, 오른쪽부터 신뢰 hop을 건너뛴 첫 비신뢰 주소를 쓴다. nginx `$proxy_add_x_forwarded_for`는 헤더를 덮어쓰지 않고 뒤에 붙인다. `201` |

### 4.5 구독

| Method | Path | 설명 |
|---|---|---|
| GET | `/subscription` | 현재 구독 조회 |
| POST | `/subscription/change` | 플랜 변경 또는 결제 절차 시작 |

결제사 Webhook은 공개 클라이언트 API와 분리하고 서명 검증에 성공한 이벤트만 처리한다. 구독이 종료되어도 브라우저 로컬 데이터를 삭제하지 않는다.

## 5. 가족 초대 상태 머신

```text
pending ──accept──> accepted
   ├────decline──> declined
   ├────cancel───> cancelled
   └────timeout──> expired
```

종료 상태에서 다른 상태로 전이하지 않는다. 재초대는 새 초대 행을 만든다.

### 5.1 초대 생성

`POST /family-invitations`

```json
{
  "household_id": "0d27a026-ed25-4b68-a9ca-9fb219c45876",
  "invitee_email": "family@example.com",
  "target_profile_ref": "5FT17CTFGGFQfHLFF09m35gJ8wF3JzY0LyD4fZvVfEI"
}
```

`target_profile_ref`는 브라우저가 이번 연결 생명주기를 위해 CSPRNG로 만든 32바이트 이상의 base64url 값이다. 로컬 프로필 ID, 이름, 생년, 관계를 암호화하거나 인코딩한 값이 아니어야 한다. 같은 초대 생성 작업을 재시도할 때는 같은 참조값과 `Idempotency-Key`를 사용하지만, 초대가 거절·취소·만료되면 새 초대에 새 참조값을 사용한다.

서버 처리 순서:

1. 요청 계정이 가정의 활성 구성원인지 확인한다.
2. 같은 가정·이메일·프로필 참조값의 대기 초대가 있는지 확인한다.
3. 32바이트 초대 토큰을 생성하고 SHA-256 해시만 DB에 저장한다.
4. 만료 시각을 생성 시각으로부터 7일로 설정한다.
5. 이메일에는 원문 토큰이 포함된 HTTPS 링크만 전송한다.
6. 감사 로그에는 초대 ID와 이벤트 종류만 기록하고 토큰·프로필 참조값 전체를 기록하지 않는다.

현재 구현은 원문 토큰을 API 응답에 반환하지 않는다. 짧은 TTL의 Redis 키에 보관하고 토큰이 없는 초대 ID만 Redis Stream에 기록해 메일 워커에 인계한다. 실제 이메일 공급자 연동은 후속 작업이다.

### 5.2 초대 수락·거절·취소

- 수락자는 로그인 이메일과 초대 이메일이 일치해야 한다.
- 수락 시 `household_memberships`를 생성하거나 기존 `left` 멤버십을 활성화한다.
- 수락만으로 `profile_links`를 생성하지 않는다.
- 수락·연결만으로 건강정보 파일을 서버에 업로드하거나 다운로드하지 않는다.
- 만료 판정은 `status`뿐 아니라 `expires_at <= now()`도 확인하고 원자적으로 `expired`로 전환한다.
- 수락과 거절 요청은 `{ "token": "<base64url>" }` 본문으로 링크의 원문 토큰을 증명한다.
- 취소는 `POST /family-invitations/{invitation_id}/cancel`을 사용하며 GET 요청으로 상태를 변경하지 않는다.

## 6. 프로필 연결 계약

`POST /profile-links`

```json
{
  "invitation_id": "2975850e-f743-4899-95e7-306c61878958",
  "local_profile_ref": "5FT17CTFGGFQfHLFF09m35gJ8wF3JzY0LyD4fZvVfEI"
}
```

사전조건:

- 초대가 `accepted` 상태다.
- 현재 계정이 초대를 수락한 계정이다.
- 요청 참조값과 초대의 `target_profile_ref`가 일치한다.
- 현재 계정은 같은 가정에서 활성 프로필 연결이 없다.
- 해당 참조값은 같은 가정의 다른 활성 계정에 연결되어 있지 않다.
- 해당 참조값은 같은 가정의 다른 초대나 종료된 과거 연결에서 사용된 적이 없다.

PostgreSQL 트랜잭션:

1. 초대 행을 `SELECT ... FOR UPDATE`로 잠근다.
2. 상태, 수락 계정, 참조값을 확인한다.
3. `profile_links`를 생성한다.
4. `account_audit_events`에 `profile_link.created`를 기록한다.
5. 커밋 후 응답한다.

연결 성공 응답은 건강정보가 존재한다는 의미가 아니다. 실제 건강정보 이전은 사용자가 로컬에서 암호화 이전 파일을 만들고 상대가 가져오는 별도 흐름이다.

`profile_id`를 보내면 같은 `family_profiles.id`로 소유권을 넘긴다(#192). 기록 행은 복사하지 않는다. 이미 다른 계정이 활성 claim을 가진 프로필이면 `PROFILE_CLAIM_CONFLICT`다. 이름만으로 병합하지 않는다. 연결 트랜잭션이 실패하면 링크와 claim을 함께 되돌린다.

추가 조회·해제 경로:

| Method | Path | 설명 |
|---|---|---|
| GET | `/profile-links` | 현재 계정의 활성·해제 연결 이력 조회 |
| POST | `/profile-links/{link_id}/unlink` | 현재 계정 소유의 활성 연결 해제 |
| POST | `/profiles/{id}/household-unshares` | 마스터. `가족 공유에서 제외`. 연결된 성인은 비밀번호 재인증 후 멤버십 LEFT·PIN·세션 회수. 계정·기록 유지. `204` |

연결 해제는 행을 삭제하지 않고 `status=unlinked`, `unlinked_at=now()`로 전환한다. 해제된 참조값은 다시 사용할 수 없으며 재연결은 새 초대와 새 불투명 참조값으로 수행한다.

## 7. 서버 데이터 금지 규칙

다음 필드나 내용이 서버 DTO·DB·Redis·로그·메트릭 태그·오류 추적·작업 큐에 들어가면 결함으로 처리한다.

- 로컬 프로필 이름, 관계, 생년
- 혈압·혈당·검사 수치·통증·가족력·유전정보
- 건강서류 파일명·본문·OCR 원문·확정값
- 예측 입력·결과·질환명
- 프로필별 기록 개수와 건강정보 기반 요약
- 백업 파일, 암호화 건강정보 본문과 복호화 키

`target_profile_ref`와 `local_profile_ref`는 허용되지만 다음 조건을 모두 지켜야 한다.

- 최소 256비트 무작위성
- base64url 표현
- 가정·프로필 내용과 독립적
- 서버 로그에서는 앞 6자만 남기거나 완전히 마스킹
- 초대 생성부터 연결 종료까지 같은 논리 작업과 재시도에서만 유지
- 초대 거절·취소·만료, 연결 해제, 계정 변경, 프로필 병합 후 즉시 폐기
- 재초대·재연결과 폐기 참조값이 포함된 백업 복구에서는 새 값 생성
- PostgreSQL 종료 이력과 유일 제약으로 생애 전체 재사용 금지; Redis TTL을 재사용 금지의 근거로 사용하지 않음

## 8. 로컬 기능과 서버 보상 처리

프로필 병합은 브라우저 로컬 트랜잭션과 서버 연결 변경을 동시에 수행하므로 분산 원자성이 없다. 다음 순서를 사용한다.

```text
로컬 복구 지점 생성
→ 로컬 병합 staged
→ 서버 profile_link 연결 또는 재연결
→ 서버 성공
→ 로컬 병합 committed, source hidden
```

서버 요청이 실패하면 로컬 작업은 `awaiting_server` 또는 `rollback_required` 상태로 남긴다. 성공을 추정해 source 데이터를 삭제하지 않는다. 재시도에는 같은 `Idempotency-Key`를 사용한다.

## 9. WebRTC 경계

WebRTC 직접 전송은 현재 OpenAPI에서 제외한다. 기술검증을 통과하면 별도 ADR과 API 버전에서 다음 메타데이터만 추가할 수 있다.

- 페어링 세션 ID와 만료 시각
- 일회성 시그널링 메시지
- 기기 공개키와 기기 확인 상태
- 연결 성공·실패 상태

건강정보 본문을 시그널링 API 또는 PostgreSQL에 저장하는 설계는 허용하지 않는다. TURN 중계를 사용할 경우 암호문이 서버를 통과한다는 사실과 보존·로그 정책을 별도로 검토한다.

## 10. 현재 코드와 목표 계약의 차이

| 현재 구현 | 목표 계약 | 필요한 변경 |
|---|---|---|
| 가입 시 성별·생년·전화번호 필수 | 이메일·비밀번호·표시 이름만 필수 | DTO·검증기·테스트 수정 |
| 이메일 유일 인덱스 없음 | `lower(email)` 유일 | DDL·Alembic 반영 |
| Refresh가 `GET /auth/token/refresh` | `POST /auth/refresh` + 회전 세션 | 라우터·세션 테이블 구현 |
| Refresh Token DB 추적 없음 | 해시 저장·회전·폐기 | `auth_sessions` 구현 |
| 공통 오류가 FastAPI `detail` 형태 | `ErrorResponse` | 예외 핸들러 구현 |
| `row_version` 없음 | `If-Match` 낙관적 잠금 | 모델·Repository 수정 |
| 가정 생성·목록·상세·폐쇄, 멤버십 조회·자진 탈퇴 구현 | 타 구성원 강제 제거 | 관리자 역할 정책 확정 전 보류 |
| 초대 생성·목록·수락·거절·취소 구현 | 실제 이메일 공급자 워커 | 후순위 구현 |
| 프로필 연결·이력 조회·연결 해제 구현 | 멱등성·If-Match | 후순위 구현 |
| 로컬 프로필 수정·숨김·빈 프로필 삭제, 가족력, 접근 범위, 병합·되돌리기, 선택 암호화 이전 구현 | 문서·OPFS 포함 대용량 이전과 UI 전체 연동 | 후순위 고도화 |

OpenAPI는 목표 계약이며 현재 FastAPI 코드가 자동으로 충족한다는 뜻이 아니다. 구현 PR은 OpenAPI 계약 테스트를 추가하고 차이를 하나씩 제거해야 한다.

## 11. 완료 기준

- OpenAPI 문서가 파서와 린터를 통과한다.
- 모든 요청 DTO가 정의되지 않은 필드를 거부한다.
- OpenAPI 응답과 FastAPI 실제 응답에 대한 계약 테스트가 통과한다.
- DDL의 유일·부분 인덱스와 상태 `CHECK`가 상태 머신을 방어한다.
- 서버 네트워크 캡처와 로그 검사에서 건강정보가 발견되지 않는다.
- 로컬 기능은 네트워크가 없어도 프로필·건강기록·백업 기능을 수행한다.
