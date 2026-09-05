# ADR-002: 서버 API와 브라우저 로컬 도메인 계약 분리

- 상태: 대체됨 — Local Domain·서버 미전송 경계는 [ADR-011](0011-postgresql-health-data-and-server-ai.md) 참조
- 결정일: 2026-08-18
- 적용 대상: React 프론트엔드, FastAPI, PostgreSQL, IndexedDB, OPFS, Web Crypto, 백업·이전 기능
- 선행 결정: [ADR-001 웹 기반 로컬 우선 서비스 전환](0001-web-local-first-architecture.md)
- 서버 계약: [API 및 로컬 기능 계약](../03_api_spec.md), [OpenAPI 3.1](../api/openapi.yaml)
- 로컬 계약: [브라우저 로컬 데이터 계약](../10_local_data_contract.md)
- 데이터 모델: [서버·로컬 ERD](../02_erd.md)

## 1. 배경

이어봄은 반응형 웹서비스이지만 가족 구성원 프로필의 내용, 건강기록, 가족력, 통증 기록, 원본 건강서류, OCR 결과와 예측 결과를 웹서버에 저장하지 않는 로컬 우선 원칙을 채택했다.

일반적인 웹서비스처럼 모든 기능을 REST API로 표현하면 건강기록 CRUD 요청이 FastAPI를 거쳐 PostgreSQL로 전달되기 쉽다. 반대로 React 화면이 IndexedDB, OPFS와 Web Crypto를 직접 호출하면 화면별 검증·암호화·오류 처리 방식이 달라지고 저장소 교체와 테스트가 어려워진다.

따라서 서버에서 처리할 서비스 메타데이터와 브라우저에서만 처리할 건강정보에 서로 다른 계약이 필요하다.

## 2. 결정

이어봄의 애플리케이션 계약을 다음 세 종류로 분리한다.

| 계약 | 실행 위치 | 책임 |
|---|---|---|
| Service Metadata REST API | FastAPI·PostgreSQL | 인증, 서비스 계정, 구독·라이선스, 가정 컨테이너, 가족 초대, 불투명 프로필 연결 |
| Local Domain API | 브라우저 TypeScript | 가족 구성원 로컬 프로필, 건강기록, 가족력, 통증, OCR, 예측, 병합, 변경 이력 |
| Backup/Transfer Container | 브라우저·사용자 파일 | 사용자가 허용한 로컬 데이터를 암호화 파일로 내보내고 가져오기 |

Local Domain API는 HTTP 서버가 아니라 브라우저 안에서 사용하는 TypeScript 인터페이스다. React UI는 IndexedDB, OPFS 또는 Web Crypto를 직접 호출하지 않는다.

## 3. 전체 구조

```text
                         React UI
                            │
              ┌─────────────┴─────────────┐
              │                           │
        서버 기능 호출                건강정보 기능 호출
        TanStack Query                Local Domain API
              │                           │
       Server API Client          ┌───────┴────────┐
              │                   │                │
           FastAPI           IndexedDB           OPFS
              │          구조화된 로컬 데이터   큰 원본 파일
         PostgreSQL                │                │
       서비스 메타데이터           └───────┬────────┘
                                           │
                                      Web Crypto
                                    저장 전 암호화
```

### 3.1 상태 관리 구분

| 상태 | 담당 | 예시 |
|---|---|---|
| 화면 상태 | Zustand | 현재 선택한 구성원, 모달 열림, 병합 단계 |
| 서버 상태 | TanStack Query | 계정, 구독, 초대, 불투명 프로필 연결 |
| 건강정보 | Local Domain API | 프로필 내용, 건강기록, 서류, 가족력, 예측 |

건강정보 원문을 Zustand의 영구 상태나 TanStack Query 캐시에 기준 데이터로 보관하지 않는다.

## 4. 서버 REST API 경계

서버 API는 다음 정보만 처리한다.

- 서비스 계정 인증정보와 세션
- 구독·라이선스 상태
- 건강정보가 없는 가정 UUID
- 가족 초대 이메일과 상태
- 무작위 불투명 가정·프로필 참조값
- 후순위로 채택될 경우 공개 기기 연결정보

다음 정보는 요청·응답·PostgreSQL·Redis·로그·작업 큐·분석 도구에 포함하지 않는다.

- 가족 구성원 로컬 프로필의 이름, 관계와 생년
- 건강기록, 통증 기록, 가족력과 유전정보
- 원본 건강서류, 파일명과 OCR 결과
- 예측 입력·결과와 로컬 변경 이력
- 프로필별 건강기록 개수와 건강정보 기반 요약
- 백업 파일과 복호화 키

서버 요청 DTO는 정의되지 않은 필드를 거부한다. 서버 계약의 원본은 `docs/api/openapi.yaml`이다.

## 5. Local Domain API 경계

Local Domain API는 다음 형태의 TypeScript 메서드를 제공한다.

```ts
interface HealthRecordService {
  create(input: CreateHealthRecordInput): Promise<LocalResult<HealthRecord>>;
  get(recordId: string): Promise<LocalResult<HealthRecord>>;
  query(input: HealthRecordQuery): Promise<LocalResult<CursorPage<HealthRecord>>>;
  update(input: UpdateHealthRecordInput): Promise<LocalResult<HealthRecord>>;
  softDelete(recordId: string, expectedVersion: number): Promise<LocalResult<void>>;
}
```

호출 흐름은 다음과 같다.

```text
입력 검증
→ 권한·프로필 존재 확인
→ 중복·버전 충돌 검사
→ 건강정보 암호화
→ IndexedDB·OPFS 쓰기
→ 로컬 변경 이력 기록
→ 성공값 또는 명시적 LocalError 반환
```

Local Domain API는 네트워크 요청을 발생시키지 않는다. 오류는 예외 문자열에 의존하지 않고 `LocalResult`의 코드로 반환한다.

## 6. 저장소 책임

### 6.1 IndexedDB

다음처럼 검색·정렬·관계 조회가 필요한 구조화 데이터를 저장한다.

- 가족 구성원 로컬 프로필
- 건강기록과 통증 기록
- 가족력과 유전정보
- OCR 원문·확정값과 신뢰도
- 예측 결과
- 원본 파일 메타데이터
- 변경 이력, 복구 지점과 병합 작업

### 6.2 OPFS

다음과 같은 큰 바이너리 파일을 암호화해 저장한다.

- 건강검진 PDF
- 촬영한 건강서류 이미지
- OCR 원본 파일
- 로컬 AI 모델
- DuckDB 파일

원본 파일명을 OPFS 경로에 사용하지 않는다. OPFS에는 파일을 한 번만 저장하고 IndexedDB에는 무작위 파일 식별자와 암호화된 메타데이터만 연결한다.

### 6.3 Web Crypto

- 건강정보와 원본 파일은 저장 전에 AES-GCM으로 암호화한다.
- 레코드와 파일 청크마다 고유 IV를 사용한다.
- 암호화 키와 서비스 계정 비밀번호를 같은 값으로 사용하지 않는다.
- 백업 포맷과 키 파생 파라미터에는 명시적인 버전을 둔다.

브라우저 암호화는 저장 장치와 백업 파일 노출을 방어하지만 실행 중인 악성 JavaScript 또는 XSS가 복호화 함수를 호출하는 위험까지 제거하지 못한다. CSP, 외부 스크립트 제한, 배포 무결성 검증을 별도로 적용한다.

## 7. 가족 초대와 건강정보 이전 분리

가족 초대와 건강정보 전송은 하나의 동작으로 처리하지 않는다.

```text
1. 서비스 계정 초대 생성       → FastAPI·PostgreSQL
2. 가입 또는 로그인 후 수락    → FastAPI·PostgreSQL
3. 불투명 프로필 참조값 연결   → FastAPI·PostgreSQL
4. 공유 범위 선택              → Local Domain API
5. 암호화 이전 파일 생성       → Local Export Service
6. 사용자가 파일 전달          → AirDrop·USB·메신저 등
7. 상대 브라우저에서 가져오기   → Local Import Service
8. IndexedDB·OPFS에 로컬 저장  → Local Domain API
```

1~3단계의 계정 연결 성공은 건강정보가 존재하거나 전달됐다는 뜻이 아니다. 건강정보는 사용자가 범위를 확인한 4단계 이후에만 이동한다.

## 8. WebRTC 적용 위치

WebRTC는 로컬 저장소를 대체하지 않는다. 향후 암호화 파일을 사용자가 외부 방법으로 전달하는 6단계만 기기 간 직접 전송으로 교체한다.

```text
현재
Local Export Service → 암호화 파일 → 사용자 전달 → Local Import Service

향후 검증 통과 시
Local Export Service → WebRTC DataChannel → Local Import Service
```

따라서 WebRTC 도입 후에도 Local Domain API, IndexedDB·OPFS 스키마와 암호화 이전 포맷은 재사용한다.

WebRTC를 실제 기능으로 채택하려면 별도 ADR에서 다음을 결정한다.

- 시그널링 서버의 저장·로그 정책
- QR 또는 확인 코드를 이용한 상대 기기 인증
- STUN·TURN 사용과 암호문 중계 범위
- 모바일 백그라운드 연결 종료
- 전송 재개, 중복과 충돌 처리
- 지원 브라우저와 실패 시 암호화 파일 fallback

## 9. 코드 구조 규칙

```text
frontend/
├─ api/
│  ├─ auth-api.ts
│  ├─ invitation-api.ts
│  └─ profile-link-api.ts
├─ local-domain/
│  ├─ profile-service.ts
│  ├─ health-record-service.ts
│  ├─ document-service.ts
│  ├─ backup-service.ts
│  └─ profile-merge-service.ts
├─ local-storage/
│  ├─ indexeddb/
│  ├─ opfs/
│  └─ crypto/
└─ stores/
   └─ ui-store.ts
```

의존 방향은 다음과 같이 고정한다.

```text
UI → Local Domain interface → Repository interface → IndexedDB·OPFS implementation
UI → Server API Client → FastAPI
```

- UI에서 `indexedDB`, OPFS handle, `crypto.subtle`을 직접 호출하지 않는다.
- Local Domain 계층에서 Fetch, Axios와 Server API Client를 호출하지 않는다.
- Server API Client의 DTO에 Local Domain 엔티티를 그대로 넘기지 않는다.
- 저장소 구현체를 테스트용 메모리 구현으로 교체할 수 있게 인터페이스를 분리한다.

## 10. 채택하지 않은 대안

### 10.1 모든 기능을 FastAPI REST API로 구현

일반적인 서버 개발 방식과 관리 편의성은 높지만 건강정보 원문이 서버 네트워크와 저장소를 통과해 ADR-001의 로컬 우선 원칙과 충돌한다.

### 10.2 React 화면에서 IndexedDB·OPFS 직접 호출

초기 코드는 짧아지지만 화면마다 검증, 암호화, 저장 트랜잭션과 오류 처리 방식이 달라지고 저장소 변경과 테스트가 어려워진다.

### 10.3 Zustand에 건강정보 전체 저장

화면 간 공유는 쉽지만 대용량 파일, 영구 저장, 트랜잭션, 암호화와 변경 이력을 안정적으로 처리하기 어렵다. Zustand는 화면 상태에만 사용한다.

### 10.4 TanStack Query로 로컬 건강정보 관리

서버 상태 캐시와 로컬 영구 저장의 책임이 섞인다. TanStack Query는 서비스 계정·구독·초대 등 서버 상태에만 사용한다.

## 11. 결과와 영향

### 긍정적 영향

- 건강정보가 서버 API로 전송되는 실수를 구조적으로 줄인다.
- UI와 저장 기술을 분리해 IndexedDB·OPFS 구현을 교체·테스트할 수 있다.
- 모든 로컬 쓰기에 같은 검증·암호화·오류 규칙을 적용할 수 있다.
- 오프라인에서도 프로필·건강기록·원본 파일·백업 기능을 사용할 수 있다.
- 암호화 파일과 향후 WebRTC가 같은 Export·Import 계약을 재사용할 수 있다.

### 부정적 영향

- 서버와 로컬 계층을 각각 설계하고 테스트해야 해 초기 코드가 늘어난다.
- 서버 트랜잭션과 로컬 트랜잭션을 하나의 원자적 작업으로 묶을 수 없다.
- 브라우저 데이터 삭제와 키 분실에 대비한 백업 UX가 필수다.
- 기기별 로컬 데이터가 자동으로 일치하지 않으므로 초기에는 사용자가 파일을 전달해야 한다.

## 12. 구현·검증 규칙

- OpenAPI 계약 테스트와 Local Domain 단위 테스트를 별도로 작성한다.
- 네트워크를 차단한 상태에서 로컬 핵심 기능이 동작해야 한다.
- 서버 요청·응답과 원격 로그에서 건강정보가 발견되면 배포를 차단한다.
- UI 코드의 IndexedDB·OPFS·Web Crypto 직접 호출을 정적 검사한다.
- 저장 공간 부족, 브라우저 종료, 암호화 실패와 손상된 백업을 테스트한다.
- 서버 연결 변경이 실패한 프로필 병합은 `rollback_required` 상태로 보존한다.

## 13. 한 문장 요약

> 서버 API는 누가 서비스를 사용하는지 관리하고, Local Domain API는 그 사용자의 브라우저에서 건강정보를 어떻게 처리하는지 관리한다.
