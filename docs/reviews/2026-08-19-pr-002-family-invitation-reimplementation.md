# PR #2 가족 초대 재설계·재구현 보고

## 결론

기존 PR #2를 그대로 병합하지 않고 현재 `main`에서 대체 구현한다. 유효한 제품 의도는 유지하되, 과거 `users bigint` 모델과 독립 마이그레이션 루트는 가져오지 않는다.

## 유지한 부분

- 생성, 목록, 수락, 거절, 취소의 다섯 초대 동작
- 기본 7일 만료
- 자기 자신 초대 금지
- 수신자만 수락·거절하고 발신자만 취소하는 규칙
- Router → Service → Repository 계층 분리
- 초대·계정 연결과 건강정보 공유는 별도 작업이라는 경계

## 교체하거나 새로 구현한 부분

| 영역 | 개선 내용 |
|---|---|
| 계정·ID | 현재 `service_accounts.id` UUID를 그대로 사용하고 PostgreSQL 17만 지원 |
| 마이그레이션 | 기존 Alembic head `ba4d3280e8b8` 뒤에 단일 revision 추가 |
| 권한 | 실제 `households`와 활성 `household_memberships`를 조회해 초대 권한 검사 |
| 동시성 | 상태 변경 시 `SELECT ... FOR UPDATE`, DB CHECK, FK, 부분 유일 인덱스 사용 |
| 중복 | `(household_id, lower(invitee_email), target_profile_ref)`의 pending 부분 유일 인덱스로 최종 방어 |
| 토큰 | 256비트 원문 토큰을 생성하고 PostgreSQL에는 SHA-256 32바이트 해시만 저장 |
| 상태 전이 | pending에서만 accepted·declined·cancelled·expired로 이동, 종료 상태 재전이 거부 |
| 조회 | GET 요청은 DB 상태를 바꾸지 않고 만료된 pending만 응답에서 expired로 계산 |
| API 오류 | 공통 `ApiResponse`·`AppError`·고정 `ErrorCode` 계약 사용 |
| 로컬 경계 | `target_profile_ref`는 43~86자 무작위 base64url 참조만 허용하고 프로필·건강정보 저장 금지 |

## Redis 사용

Redis는 PostgreSQL과 역할을 겹치게 사용하지 않는다.

| 키 범주 | 목적 | 수명·실패 정책 |
|---|---|---|
| `invite:token:{sha256}` | 원문 토큰의 1회성 allowlist | 초대 만료까지, 생성·소비 장애는 fail-closed |
| `invite:used:{sha256}` | 소비된 링크 재사용 구분 | 소비 후 7일 |
| `invite:delivery:{id}` | 메일 워커가 한 번 가져갈 원문 토큰 | 기본 5분, `GETDEL` |
| `invite:delivery:stream` | 워커에게 전달 대상 초대 ID 통지 | 원문 토큰 미포함, 길이 제한 |
| `invite:rate:account:*` | 계정별 초대 생성 제한 | 기본 분당 10회 |
| `invite:rate:email:*` | 특정 이메일 대상 대량 초대 제한 | 기본 시간당 20회, 이메일은 SHA-256 키화 |
| `invite:rate:transition:*` | 수락·거절 검증 경로 남용 제한 | 계정·초대별 기본 분당 20회 |

Redis를 초대 상태의 정본이나 분산 잠금으로 사용하지 않는다. 취소·수락의 정확성은 PostgreSQL이 보장하고 Redis 정리 실패는 DB 상태 검사와 TTL로 안전하게 수렴한다. 자세한 이유는 [ADR-004](../adr/0004-family-invitation-state-and-redis-boundary.md)에 남겼다.

## 구현 API

| Method | Path | 동작 |
|---|---|---|
| POST | `/api/v1/households` | 빈 서버 가정 컨테이너와 생성자 멤버십 생성 |
| GET | `/api/v1/households` | 현재 계정의 활성 가정 목록 |
| POST | `/api/v1/family-invitations` | 기존 로컬 프로필 참조 대상 초대 생성 |
| GET | `/api/v1/family-invitations` | 보낸 초대·받은 초대 분리 조회 |
| POST | `/api/v1/family-invitations/{id}/accept` | 이메일·토큰 검증 후 멤버십 생성 또는 재활성화 |
| POST | `/api/v1/family-invitations/{id}/decline` | 이메일·토큰 검증 후 거절 |
| POST | `/api/v1/family-invitations/{id}/cancel` | 발신자가 대기 초대 취소 |

원문 초대 토큰은 생성 응답에 반환하지 않는다. 현재 구현은 메일 워커가 소비할 Redis 인계까지 제공하고, 실제 이메일 공급자 연동은 포함하지 않는다.

## 이번 변경에서 의도적으로 남긴 후속 작업

- 이메일 워커와 공급자 연동, 재시도·dead-letter 운영 정책
- `Idempotency-Key` 저장과 응답 재생
- `If-Match` 기반 외부 낙관적 잠금 계약
- 수락된 초대와 `profile_links`의 별도 연결 API
- 구성원별 건강정보 접근 범위와 암호화 기기 간 전송
- 초대 재전송·재발급 UX

이 항목은 삭제 기능이 아니라 후순위 구현이다. 특히 수락은 서버 멤버십만 만들며 건강정보 업로드·다운로드나 로컬 프로필 자동 생성을 수행하지 않는다.

## 검증 기준

- PostgreSQL 17에서 전체 Alembic upgrade와 downgrade, `alembic check`
- Ruff, mypy
- 기존 API 회귀 테스트 전체
- 초대 성공, 권한 거부, 중복, 자기 초대, 잘못된 토큰, 취소 후 수락 거부
- Redis 원문 전달 1회성, 토큰 재사용 탐지, 속도 제한

실행 결과:

- `ruff format --check app`: 통과
- `ruff check app`: 통과
- `mypy app`: 통과
- `pytest app/tests -q`: 93개 통과
- PostgreSQL 17 `alembic downgrade base → upgrade head → alembic check`: 통과, 미반영 작업 없음

테스트에는 기존부터 발생하던 FastAPI의 `ORJSONResponse` 폐기 예정 경고가 남아 있다. 이번 초대 구현의 실패는 아니며 별도 정리 대상으로 둔다.
