# API 및 로컬 기능 명세서 — 초안

> 담당: 권민재(주도), 정다원(보조)
> 관련 문서: [01_requirements.md](01_requirements.md), [08_account_profile_policy.md](08_account_profile_policy.md)

## 1. 경계 원칙

서버 API는 서비스 계정, 구독, 가족 초대와 최소 연결정보만 처리한다. 건강기록·원본 서류·가족력·OCR·예측·변경 이력은 서버 API로 전송하지 않고 기기 내 기능으로 처리한다.

```text
서버 API: 인증 / 구독 / 초대 / 최소 프로필 연결 / 기기 등록
로컬 기능: 프로필 / 건강기록 / OCR / 예측 / 백업 / 병합 / 동기화
```

## 2. 서버 API 공통 규칙

- Base URL: `/api/v1`
- 인증: `Authorization: Bearer <access_token>`
- 응답: `{ "data": ..., "message": "...", "success": true }`
- 오류: `{ "error_code": "...", "message": "...", "success": false }`
- 요청·응답에 건강정보 원문, 프로필 이름·생년·관계, 기록 개수를 포함하지 않는다.

## 3. 서버 엔드포인트

### 인증·계정 — 1순위

| Method | Endpoint | 설명 | 인증 |
|---|---|---|---|
| POST | `/auth/signup` | 서비스 계정 생성 | N |
| POST | `/auth/login` | 로그인과 토큰 발급 | N |
| POST | `/auth/refresh` | Access Token 갱신 | Refresh |
| POST | `/auth/logout` | 로그아웃 | Y |
| GET | `/account` | 계정·구독 요약 | Y |
| DELETE | `/account` | 서비스 계정 해지(로컬 데이터 미삭제) | Y |

### 구독·라이선스 — 1순위

| Method | Endpoint | 설명 | 인증 |
|---|---|---|---|
| GET | `/subscription` | 구독·라이선스 상태 조회 | Y |
| POST | `/subscription/change` | 플랜 변경 요청 | Y |

### 가족 초대 — 2순위

| Method | Endpoint | 설명 | 인증 |
|---|---|---|---|
| POST | `/family-invitations` | 기존 로컬 프로필 참조값을 대상으로 초대 생성 | Y |
| GET | `/family-invitations` | 보낸·받은 초대 상태 조회 | Y |
| POST | `/family-invitations/{id}/accept` | 초대 수락 | Y |
| POST | `/family-invitations/{id}/decline` | 초대 거절 | Y |
| DELETE | `/family-invitations/{id}` | 대기 중 초대 취소 | Y |

### 최소 프로필 연결 — 2순위

| Method | Endpoint | 설명 | 인증 |
|---|---|---|---|
| POST | `/profile-links` | 수락한 초대와 기존 로컬 프로필 참조값 연결 | Y |
| GET | `/profile-links/me` | 현재 계정의 연결 상태 조회 | Y |
| DELETE | `/profile-links/{id}` | 계정·프로필 연결 해제 | Y |

### 기기 상태 — 3순위

| Method | Endpoint | 설명 | 인증 |
|---|---|---|---|
| POST | `/devices` | 기기 등록과 공개 연결정보 저장 | Y |
| GET | `/devices` | 연결 가능한 본인 기기 조회 | Y |
| DELETE | `/devices/{id}` | 기기 등록 해제 | Y |

서버의 기기 API는 건강정보를 중계하거나 저장하지 않는다. 실제 건강정보 전송은 사용자가 승인한 기기끼리 암호화해 수행한다.

## 4. 초대·프로필 연결 계약

`POST /family-invitations`

```json
{
  "invitee_email": "family@example.com",
  "household_ref": "opaque-household-ref",
  "target_profile_ref": "opaque-profile-ref"
}
```

서버 참조값은 이름, 관계, 생년 또는 건강정보를 포함하지 않는 불투명 값이어야 한다.

초대 수락 후 `POST /profile-links`가 성공해도 건강정보 전송은 시작하지 않는다. 별도의 접근 범위 확인과 기기 연결이 완료되어야 한다.

## 5. 기기 로컬 기능 인터페이스

다음 기능은 서버 REST API가 아니라 프론트엔드의 로컬 저장·도메인 계층에서 제공한다.

| 기능 | 입력 | 결과 | 우선순위 |
|---|---|---|---:|
| 로컬 프로필 생성 | 이름·관계·생년 | `family_profile` 저장 | 1 |
| 건강기록 CRUD | 프로필·기록 값 | 로컬 이력 갱신 | 1 |
| 암호화 백업 | 로컬 가정 데이터·비밀번호 | 암호화 파일 | 1 |
| OCR | 원본 이미지 | 로컬 인식 결과·신뢰도 | 2 |
| 프로필 비교 | source·target 프로필 | 충돌 목록 | 2 |
| 프로필 병합 | 사용자 충돌 선택 | 병합 결과·복구 지점 | 2 |
| 병합 취소 | 병합 작업 ID | 병합 전 상태 복원 | 2 |
| 기기 동기화 | 허용 범위·암호화 세션 | 상대 기기 로컬 저장 | 3 |

## 6. 프로필 병합 처리 순서

1. source와 target이 같은 사람인지 확인한다.
2. 병합 전 복구 지점을 생성한다.
3. 기본정보·기록·파일·가족력 충돌을 계산한다.
4. 사용자가 충돌별 처리 방법을 선택한다.
5. 로컬 트랜잭션으로 target에 데이터를 반영한다.
6. 서비스 계정 연결을 target 참조값으로 변경한다.
7. source를 숨김 처리하고 되돌리기 기한을 저장한다.

서버 연결 변경이 실패하면 로컬 병합을 완료 상태로 확정하지 않고 복구 가능한 상태로 남겨야 한다.

## 7. 주요 오류 코드

| 오류 코드 | 의미 |
|---|---|
| `INVITATION_EXPIRED` | 초대 만료 |
| `PROFILE_ALREADY_LINKED` | 같은 가정에서 계정이 이미 다른 프로필에 연결됨 |
| `PROFILE_REF_INVALID` | 유효하지 않은 불투명 프로필 참조값 |
| `PROFILE_MERGE_CONFLICT` | 사용자 확인이 필요한 병합 충돌 |
| `PROFILE_MERGE_NOT_SAFE` | 서로 다른 사람일 가능성으로 병합 중단 |
| `DEVICE_PAIRING_REQUIRED` | 건강정보 전송 전 기기 연결 필요 |
| `LOCAL_ROLLBACK_REQUIRED` | 서버 연결 변경 실패로 로컬 복구 필요 |

## 8. 미확정 사항

대표 관리자·공동 관리자와 같은 별도 역할 기반 API는 만들지 않는다. 역할 정책이 확정된 후 별도 요구사항과 API로 추가한다.
