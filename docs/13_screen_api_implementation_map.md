# 화면·API 구현 매핑

> 기준일: 2026-08-19
> 화면 기준: Figma `5:2` Manyfast·가족력·로컬 우선 반영안
> 관련 문서: [와이어프레임](04_wireframe.md), [서버 API](03_api_spec.md), [로컬 데이터 계약](10_local_data_contract.md), [프론트엔드 구현 로드맵](12_frontend_figma_implementation_roadmap.md)

## 1. 목적

와이어프레임의 화면을 모두 FastAPI 엔드포인트로 해석하지 않는다. 서비스 계정 메타데이터는 Server REST API, 건강정보는 브라우저 Local Domain API를 사용하며 한 화면에서 두 경계가 필요하면 호출 시점과 데이터 타입을 분리한다.

## 2. 현재 서버 REST API

| 화면·기능 | 실제 엔드포인트 | 현재 상태 | 프론트 연결 |
|---|---|---|---|
| 서비스 계정 가입 | `POST /api/v1/auth/signup` | 구현됨 | `ServerApiClient.signUp` |
| 로그인 | `POST /api/v1/auth/login` | 구현됨 | `ServerApiClient.login` |
| 토큰 갱신 | `POST /api/v1/auth/refresh` | HttpOnly 쿠키 회전 구현됨 | `ServerApiClient.refresh` 및 401 1회 재시도 |
| 로그아웃 | `POST /api/v1/auth/logout` | 구현됨 | `ServerApiClient.logout` |
| 계정·구독 요약 | `GET /api/v1/account` | 구현됨 | `ServerApiClient.getAccount` |
| 계정 해지 | `DELETE /api/v1/account` | 구현됨, 로컬 데이터는 삭제하지 않음 | `ServerApiClient.closeAccount` |
| 구독 조회·변경 | `GET /api/v1/subscription`, `POST /api/v1/subscription/change` | 구현됨 | `getSubscription`, `changeSubscription` |
| 가정 생성·목록 | `POST/GET /api/v1/households` | 구현됨 | `createHousehold`, `listHouseholds` |
| 가족 초대 생성·목록 | `POST/GET /api/v1/family-invitations` | 구현됨 | `createInvitation`, `listInvitations` |
| 초대 수락·거절·취소 | `POST .../{id}/accept`, `decline`, `cancel` | 구현됨 | 각 transition 메서드 |
| 계정·프로필 연결 | `/api/v1/profile-links` | PR #6에서 진행 중 | 병합 전 중복 구현 금지 |
| OCR·AI worker | 서버 OCR API | PR #8에서 검증 중 | 실제 사용자 건강정보 제품 경로에서는 사용 금지 |

Access Token은 프론트 메모리에만 두고 localStorage·IndexedDB에 저장하지 않는다. 페이지 재실행 뒤에는 HttpOnly Refresh Cookie로 Access Token을 한 번 복구한다.

## 3. Local Domain API

| 화면·기능 | 로컬 서비스 | 정본 | 현재 상태 |
|---|---|---|---|
| 가족 구성원 생성·목록 | `LocalProfileService` | IndexedDB 암호문 | 생성·조회·목록 구현 |
| 건강기록 작성·조회 | `LocalHealthRecordService` | IndexedDB 암호문 | 생성·조회·필터 구현 |
| 구성원 대시보드 | `LocalDashboardService` | 복호화한 로컬 기록의 메모리 집계 | 기록 수·유형·최근 시각 구현 |
| 전체 백업 파일 | `LocalBackupService` | 사용자 파일 | IndexedDB 레코드 단일 암호화 파일 왕복 구현 |
| 로컬 키 | `IndexedDbLocalKeyVault` | IndexedDB의 비추출형 `CryptoKey` | 재실행 복구 구현 |
| PDF·이미지 원본 | `DocumentService` | OPFS 암호화 청크 | 미구현 |
| OCR | 브라우저 Worker/WASM adapter | OPFS·IndexedDB | 제품 adapter 미구현 |
| 가족력·통증·예측 | Local Domain 확장 | IndexedDB 암호문 | 후속 구현 |

`createLocalDomainRuntime()`이 Repository, 로컬 키, 프로필, 건강기록, 대시보드와 백업 서비스를 같은 데이터베이스 경계로 조립한다. Local Domain 구현은 Fetch·Server API Client·TanStack Query를 import하지 않는다.

## 4. 첫 수직 흐름

```text
가정 식별자 선택
→ 가족 구성원 로컬 프로필 생성
→ 비추출형 기기 키로 암호화
→ IndexedDB 저장
→ 건강기록 작성·암호화 저장
→ 대시보드 로컬 집계
→ 단일 암호화 백업 파일 생성
→ 새 저장소·새 로컬 키로 가져오기
```

자동 테스트는 저장된 envelope와 백업 파일에 프로필 이름·건강 필드명이 평문으로 남지 않는지 확인한다.

### 4.1 프론트 연결 현황

| 경로 | 화면 | 연결 상태 |
|---|---|---|
| `/` | 가족 홈·구성원 목록·구성원 대시보드 | `LocalProfileService`, `LocalDashboardService` 연결 |
| `/` 모달 | 구성원 등록·건강기록 작성 | `LocalProfileService.create`, `LocalHealthRecordService.create` 연결 |
| `/data` | 암호화 백업 내보내기·검증·가져오기 | `LocalBackupService` 연결 |
| `/dev/architecture` | 서버·로컬 데이터 경계 개발 검증 | 서버 요청과 로컬 경로 분리 확인 |

제품 홈의 구성원 등록부터 건강기록 작성·새로고침 후 재조회까지 `/api` 요청이 발생하지 않는 Playwright E2E로 검증한다. 화면은 390px 모바일과 1440px 데스크톱에서 같은 작업 순서를 유지한다.

## 5. 아직 해소할 계약 차이

- 목표 OpenAPI의 초대 취소는 `DELETE /family-invitations/{id}`이지만 현재 코드는 `POST /family-invitations/{id}/cancel`이다.
- 목표 계약의 `Idempotency-Key`와 `If-Match`가 현재 가족 초대 라우터 전체에 적용되지는 않았다.
- PR #6 프로필 연결이 병합되면 일회용 참조값 ADR-006과 신규 마이그레이션 head를 기준으로 rebase해야 한다.
- PR #8 서버 OCR은 합성·비식별 검증 경로와 실제 사용자 제품 경로를 분리해야 한다. 실제 문서·OCR 결과·건강 파생값을 PostgreSQL이나 Redis에 저장하지 않는다.
- 현재 백업은 IndexedDB 레코드의 최소 왕복이다. OPFS 파일, 대용량 스트리밍, 충돌 병합과 이전 버전 변환은 후속 구현한다.

## 6. 다음 구현 순서

1. 구성원·기록 상세 URL을 `/members/:id`, `/members/:id/records`로 분리하고 수정 화면을 추가한다.
2. 로컬 optimistic version 기반 수정·숨김 삭제·복원을 구현한다.
3. OPFS `DocumentService`와 단일 백업 컨테이너 파일 포함을 구현한다.
4. 브라우저 로컬 OCR adapter와 결과 검토 화면을 구현한다.
5. PR #6 병합 후 초대·프로필 연결 화면을 Server API Client에 추가한다.
6. 목표 OpenAPI와 실제 초대 취소·멱등성·If-Match 계약을 하나로 통일한다.
