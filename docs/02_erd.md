# 데이터 모델 — 서버·로컬 분리 초안

> 담당: 조현승(주도), 권민재(지원)
> 관련 문서: [01_requirements.md](01_requirements.md), [08_account_profile_policy.md](08_account_profile_policy.md)

## 1. 설계 원칙

이어봄은 서버 데이터와 사용자 기기의 로컬 데이터를 분리한다. 서버 데이터베이스에는 건강정보를 저장하지 않는다.

```text
서버: 인증·구독·초대·최소 연결정보
기기: 가족 프로필·건강기록·서류·가족력·예측·변경 이력
```

## 2. 서버 데이터 모델

| 엔티티 | 설명 |
|---|---|
| `service_accounts` | 로그인에 사용하는 서비스 계정 |
| `subscriptions` | 구독·라이선스 상태 |
| `family_invitations` | 가족 초대와 수락 상태 |
| `profile_links` | 서비스 계정과 로컬 프로필을 잇는 최소 연결정보 |
| `registered_devices` | 계정에 등록된 기기와 연결 상태 |

### service_accounts

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | PK, UUID | 서버 계정 식별자 |
| email | varchar(255), unique | 로그인 식별자 |
| password_hash | varchar(255) | 인증용 해시 |
| status | enum | active, suspended, closed |
| closed_at | timestamptz, null | 해지 시각. 유예기간 계산의 기준 |
| created_at | timestamptz | 생성 시각 |
| updated_at | timestamptz | 마지막 수정 시각 |

### subscriptions

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | PK, UUID | 구독 식별자 |
| account_id | FK, unique | 결제·구독 계정. 계정당 구독 1개 |
| plan | varchar(20) | FREE, BASIC, FAMILY |
| status | enum | active, expired, cancelled |
| renewed_at | timestamptz, null | 갱신 시각. 갱신 이력이 없으면 null |
| created_at | timestamptz | 생성 시각 |
| updated_at | timestamptz | 마지막 수정 시각 |

> **구현 시 확장한 항목** (docs/05_tech_architecture.md 10절 협업 규칙에 따라 기록)
>
> - `service_accounts.closed_at` — `DELETE /account`가 유예기간 후 파기 방식이라 해지 시각이 필요하다. 유예기간은 14일로 가정했고 파기 배치는 아직 없다.
> - `service_accounts.updated_at`, `subscriptions.created_at/updated_at` — 감사 흔적용.
> - `subscriptions.account_id`에 unique — 현재 계정당 구독 1개다. 2순위 가족 라이선스가 들어오면 재검토한다.
> - enum은 네이티브 PostgreSQL ENUM이 아니라 `varchar` + CHECK 제약으로 구현했다. 네이티브 ENUM은 값 추가·변경을 Alembic autogenerate가 감지하지 못해, 열거형이 여럿인 이 스키마에서는 변경 비용이 계속 누적된다.

### family_invitations

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | PK, UUID | 초대 식별자 |
| inviter_account_id | FK | 초대한 서비스 계정 |
| invitee_email | varchar | 초대 대상 이메일 |
| target_profile_ref | varchar | 건강정보가 없는 불투명 로컬 프로필 참조값 |
| status | enum | pending, accepted, declined, expired, cancelled |
| expires_at | timestamp | 만료 시각 |

### profile_links

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | PK, UUID | 연결 식별자 |
| account_id | FK | 연결된 서비스 계정 |
| household_ref | varchar | 불투명 가정 참조값 |
| local_profile_ref | varchar | 불투명 로컬 프로필 참조값 |
| linked_at | timestamp | 연결 시각 |

`profile_links`에는 이름, 생년, 관계, 건강기록 요약을 저장하지 않는다. `(account_id, household_ref)`는 유일해야 하며 같은 가정에서 한 계정이 여러 프로필에 연결되지 않도록 한다.

## 3. 로컬 데이터 모델

| 엔티티 | 설명 |
|---|---|
| `local_households` | 기기 안의 가족 데이터 컨테이너 |
| `family_profiles` | 가족 구성원 로컬 프로필 |
| `health_records` | 수치·서술형 건강기록 |
| `health_documents` | 원본 건강서류와 로컬 파일 참조 |
| `ocr_results` | 기기에서 생성한 OCR 결과와 수정값 |
| `family_histories` | 가족력과 유전정보 |
| `prediction_results` | 로컬 모델 예측 결과 |
| `change_events` | 로컬 데이터 변경 이력 |
| `restore_points` | 복구·병합 전 데이터 상태 |
| `profile_merge_operations` | 프로필 병합 과정과 결과 |
| `device_sync_states` | 기기별 동기화 상태와 충돌 정보 |

### family_profiles

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | PK, UUID | 로컬 프로필 식별자 |
| household_id | FK | 로컬 가정 |
| name | varchar | 표시 이름 |
| relationship | varchar | 관계 |
| birth_date | date, nullable | 생년 정보 |
| status | enum | active, hidden, merged |
| merged_into_profile_id | UUID, nullable | 병합된 기존 프로필 |
| created_at / updated_at | timestamp | 변경 시각 |

### health_records

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | PK, UUID | 건강기록 식별자 |
| profile_id | FK | 기록 소유 로컬 프로필 |
| record_type | varchar | 혈압, 혈당, 통증 등 |
| recorded_at | timestamp | 기록 시각 |
| values | json | 유형별 수치·메모 |
| source | enum | manual, ocr, import, local_ai |
| created_at / updated_at | timestamp | 변경 시각 |

### profile_merge_operations

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | PK, UUID | 병합 작업 식별자 |
| source_profile_id | FK | 잘못 만든 새 프로필 |
| target_profile_id | FK | 유지할 기존 프로필 |
| restore_point_id | FK | 병합 전 복구 지점 |
| conflict_summary | json | 충돌 항목과 사용자 선택 |
| status | enum | reviewing, completed, reverted, failed |
| undo_expires_at | timestamp | 되돌리기 만료 시각 |
| created_at / completed_at | timestamp | 처리 시각 |

## 4. 주요 관계

- 서버 `service_accounts` 1:N `family_invitations`
- 서버 `service_accounts` 1:N `profile_links`(가정별 최대 1개)
- 로컬 `local_households` 1:N `family_profiles`
- 로컬 `family_profiles` 1:N `health_records`, `health_documents`, `family_histories`, `prediction_results`
- 로컬 `profile_merge_operations` N:1 source/target `family_profiles`
- 로컬 `profile_merge_operations` 1:1 `restore_points`

서버의 불투명 프로필 참조값과 로컬 프로필 ID를 연결하는 매핑은 사용자 기기에 보관한다. 서버는 참조값만으로 건강정보나 프로필 내용을 복원할 수 없어야 한다.

## 5. 병합 무결성 규칙

- 병합 전에 복구 지점을 생성한다.
- 병합 완료 전 source 데이터를 삭제하지 않는다.
- 동일 파일은 해시로 중복 여부를 확인한다.
- 서로 다른 사람일 가능성이 감지되면 병합을 중단한다.
- 병합 완료 후 source 프로필은 `hidden` 또는 `merged` 상태로 둔다.
- 되돌리기 기간이 끝나기 전까지 원본 복구 정보를 유지한다.

## 6. 다음 단계

1. 서버 ERD와 로컬 스키마를 별도 다이어그램으로 작성한다.
2. 로컬 저장 기술(IndexedDB/OPFS 또는 앱 내 DB)을 확정한다.
3. 불투명 프로필 참조값 생성·회전·폐기 규칙을 보안 검토한다.
4. 백업 스키마 버전과 병합 트랜잭션 테스트 케이스를 정의한다.
