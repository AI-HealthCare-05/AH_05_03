# PR #3 최소 프로필 연결 구현 보고

## 결론

PR #2에서 후속 작업으로 남겼던 `profile_links`를 구현했다. 서버는 서비스 계정과 불투명 로컬 프로필 참조값의 연결 사실만 저장하고, 프로필 이름·관계·생년과 건강정보는 여전히 브라우저에만 둔다.

## 구현 API

| Method | Path | 동작 |
|---|---|---|
| POST | `/api/v1/profile-links` | 수락된 초대와 기존 로컬 프로필 참조값을 연결 |
| GET | `/api/v1/profile-links/me` | 현재 계정의 연결 목록, `household_id`로 좁힐 수 있음 |
| DELETE | `/api/v1/profile-links/{profile_link_id}` | 연결을 `unlinked`로 종료 |

## 연결 사전조건

`docs/03_api_spec.md` 6절의 순서를 그대로 따른다.

1. 초대 행을 `SELECT ... FOR UPDATE`로 잠근다.
2. 초대를 수락한 계정이 요청자인지 확인한다. 아니면 초대의 존재도 알리지 않고 `INVITATION_NOT_FOUND`를 반환한다.
3. 초대가 `accepted` 상태인지 확인한다.
4. 요청 참조값과 초대의 `target_profile_ref`를 `hmac.compare_digest`로 비교한다.
5. 요청 계정이 해당 가정의 활성 구성원인지 확인한다.
6. 같은 가정에서 계정의 활성 연결과 참조값 점유 여부를 확인한다.
7. 연결을 만들고 커밋한다.

6번의 사전 검사가 경합에 지면 부분 유일 인덱스가 최종 방어선이 된다. `IntegrityError`의 제약 이름을 같은 오류 코드로 되돌려, 검사를 통과했든 인덱스에 걸렸든 클라이언트가 보는 응답이 같다.

## 스키마

`docs/database/0002_service_domain.sql`의 `profile_links` 정의를 SQLAlchemy 모델로 옮기고 Alembic revision `2861d7594df1`을 추가했다.

| 제약 | 목적 |
|---|---|
| `uq_profile_links_one_active_profile_per_account_household` | 한 가정에서 계정 하나는 프로필 하나에만 연결 |
| `uq_profile_links_one_active_account_per_profile` | 한 참조값을 계정 하나만 점유 |
| `uq_profile_links_invitation_id` | 초대 하나가 만드는 연결은 하나 |
| `ck_profile_links_local_profile_ref_format` | 43~86자 base64url 참조값만 허용 |
| `ck_profile_links_profile_link_status_unlinked_at_consistent` | `unlinked`에서만 `unlinked_at`이 존재 |

앞의 두 인덱스는 `status = 'active'` 부분 인덱스다. 해제된 행은 제약에서 빠지므로 재연결 흐름을 막지 않는다.

## 신설 오류 코드

| 오류 코드 | HTTP | 발생 조건 |
|---|---:|---|
| `PROFILE_REF_INVALID` | 400 | 요청 참조값이 초대의 `target_profile_ref`와 다름 |
| `PROFILE_ALREADY_LINKED` | 409 | 같은 가정에서 계정이 이미 다른 프로필에 연결됨 |
| `PROFILE_REF_ALREADY_CLAIMED` | 409 | 같은 참조값을 다른 계정이 점유 중 |
| `PROFILE_LINK_NOT_FOUND` | 404 | 연결이 없거나 요청 계정의 것이 아님 |

`PROFILE_REF_INVALID`를 422가 아니라 400으로 둔 이유는 형식이 아니라 요청 조합이 잘못된 경우이기 때문이다. 2.3절의 `INVALID_REQUEST` 분류에 해당하고, 기존 `INVITATION_SELF_NOT_ALLOWED`와 같은 자리다.

## 목표 계약과 남은 차이

| 항목 | 현재 | 이유 |
|---|---|---|
| `Idempotency-Key` | 미구현 | `api_idempotency_keys` 저장·응답 재생은 전 엔드포인트 공통 작업이라 분리 |
| `If-Match` | 미구현 | 같은 이유. `row_version`은 응답에 이미 실려 있어 계약만 얹으면 된다 |
| `account_audit_events` | 미구현 | 감사 테이블 자체가 아직 없음 |
| DELETE 응답 | `200` + 봉투 | 성공 봉투가 모든 응답에 필수인데 `204`는 본문을 가질 수 없다. `DELETE /account`와 같은 선택 |

해제는 멱등하게 만들었다. 이미 `unlinked`인 연결에 같은 요청이 오면 상태를 바꾸지 않고 현재 상태를 반환한다. `Idempotency-Key`가 들어오기 전까지 재시도한 클라이언트가 409를 받지 않게 하기 위해서다.

## 검증

- `ruff format --check app`: 통과
- `ruff check app`: 통과
- `mypy app`: 통과
- `pytest app/tests -q`: 102개 통과 (기존 93 + 신규 9)
- PostgreSQL 17 `alembic downgrade base → upgrade head → alembic check`: 통과, 미반영 작업 없음

신규 테스트가 덮는 경로는 연결 성공과 목록 조회, 참조값 불일치, 수락 전 초대, 제3자의 연결 시도, 계정당 활성 연결 하나 제약, 참조값 선점, 해제 멱등, 타 계정의 해제 시도, 금지 필드 거부다.
