# ADR-005: Vite SPA 기반 로컬 우선 프론트엔드

- 상태: 승인
- 결정일: 2026-08-19
- 적용 대상: React 프론트엔드, 브라우저 로컬 데이터, 서버 상태, 로컬 모델 실행
- 선행 결정: [ADR-001 웹 기반 로컬 우선 서비스 전환](0001-web-local-first-architecture.md), [ADR-002 서버 API와 브라우저 로컬 도메인 계약 분리](0002-separate-server-api-and-local-domain-contract.md)
- 구현 기준: [로컬 규칙·ML 모델 실행 구현 가이드](../11_local_model_runtime_implementation.md)

## 배경

이어봄은 반응형 웹서비스이지만 프로필 원문, 건강기록, 가족력, 서류, OCR 결과와 건강 평가 입출력을 서버로 보내지 않는다. 프론트엔드 기반을 선택할 때 일반 웹서비스의 생산성뿐 아니라 브라우저 로컬 저장과 서버 상태가 코드 구조에서도 섞이지 않게 해야 한다.

React 공식 문서는 새 애플리케이션에 프레임워크 사용을 우선 권장한다. 그러나 이어봄의 초기 화면은 SEO나 서버 렌더링보다 IndexedDB, OPFS, Web Crypto와 Web Worker를 사용하는 클라이언트 실행 경계가 핵심이다. 서버 컴포넌트나 서버 액션을 쉽게 사용할 수 있는 구조는 팀원이 건강정보 처리를 편의상 서버로 옮길 가능성도 높인다.

## 결정

- 프론트엔드는 `frontend/` 아래의 React·TypeScript SPA로 구성하고 Vite로 개발·빌드한다.
- 초기 라우팅은 React Router를 사용한다. SSR과 서버 컴포넌트는 도입하지 않는다.
- npm과 lockfile을 사용해 프론트 의존성을 재현한다.
- 화면 상태는 Zustand, 계정·구독·초대 같은 서버 상태는 TanStack Query가 담당한다.
- 건강정보는 Zustand 영속 상태나 TanStack Query 캐시에 넣지 않고 Local Domain API를 통해서만 다룬다.
- Local Domain 계층은 Fetch·Axios와 서버 API Client를 import하지 않는다.
- IndexedDB, OPFS와 Web Crypto는 UI가 직접 호출하지 않고 저장소·암호화 포트 뒤에 둔다.
- 로컬 모델은 Web Worker 인터페이스 뒤에서 실행한다. 기초 단계에서는 합성 입력용 mock engine만 연결한다.
- Python 참조 모델, Pyodide, Rust/WASM과 ONNX는 이 기초 단계의 브라우저 번들에 포함하지 않는다.
- Vitest로 계약·로컬 저장 경계를 검사하고 Playwright로 로컬 모델 동작 중 `/api` 요청이 발생하지 않는 사례를 검사한다.

## 경계를 설명하는 사례

### 건강기록을 입력하는 경우

UI는 Local Domain API를 호출하고 Local Domain API가 Web Crypto와 IndexedDB·OPFS 저장소를 사용한다. 이 흐름에서 TanStack Query와 FastAPI는 호출하지 않는다.

### 구독 상태를 확인하는 경우

UI는 TanStack Query를 통해 Server API Client를 호출한다. 응답에는 서비스 계정과 구독 메타데이터만 포함하며 로컬 건강 엔티티를 query key나 요청 DTO로 넘기지 않는다.

### 건강 평가를 실행하는 경우

복호화된 입력은 브라우저 메모리에서 Web Worker로 전달하고 결과를 로컬에 저장한다. 평가 버튼을 눌렀을 때 `/api` 요청이 한 건이라도 발생하면 E2E 테스트를 실패시킨다.

### 팀원이 Python 규칙 모델을 재사용하려는 경우

Python은 개발자 PC와 CI의 참조 구현이다. FastAPI에서 import하거나 Pyodide로 브라우저에 그대로 싣지 않는다. 공통 golden fixture를 사용해 향후 TypeScript·Rust/WASM·ONNX 제품 구현의 결과만 대조한다.

## 검토한 대안

### Next.js 등 서버 기능이 포함된 React 프레임워크

현재는 보류한다. 라우팅·빌드·배포의 통합 이점은 있지만 초기 제품에 SSR·SEO 요구가 없고, 서버 컴포넌트와 서버 액션이 로컬 건강정보 경계를 흐릴 수 있다. 공개 콘텐츠, SSR 또는 정적 생성이 핵심 요구가 되면 별도 ADR에서 다시 비교한다.

### React Router 프레임워크 모드

현재는 보류한다. Vite와 표준 Web API를 활용하는 장점은 유지할 수 있지만 서버 로더·액션을 함께 도입할 이유가 아직 없다. 초기에는 명시적인 SPA 라우터만 사용한다.

### UI에서 IndexedDB·Web Crypto를 직접 호출

기각한다. 화면마다 저장·암호화·오류 처리가 달라지고 테스트 대역과 저장소 이전이 어려워진다.

### 모든 상태를 Zustand에 저장

기각한다. 서버 상태의 캐시·재검증 책임과 건강정보 정본이 화면 상태에 섞이며, 영속화 미들웨어 설정 실수로 평문 건강정보가 노출될 수 있다.

### 건강정보도 TanStack Query로 관리

기각한다. query key, 캐시, 개발 도구와 디버깅 과정에 건강정보가 남을 수 있고 서버 상태와 로컬 정본의 경계가 사라진다.

### 처음부터 PWA와 Service Worker 적용

보류한다. 설치와 오프라인 셸에는 유리하지만 캐시 버전, 롤백, 민감 파일 캐싱과 배포 장애 모드가 추가된다. 기본 SPA와 로컬 백업 흐름이 안정된 뒤 별도 결정한다.

### Pyodide로 Python 모델을 브라우저에서 실행

현재 기각한다. 단순 규칙 모델에 비해 런타임 크기, 콜드 스타트, 모바일 메모리와 패키지 운영 비용이 크다. 연구 데모가 필요하면 제품 경로와 분리한 기술검증만 허용한다.

## 결과와 감수할 단점

- 브라우저 로컬 기능과 원격 서버 기능의 의존 방향을 명확히 테스트할 수 있다.
- 정적 결과물을 Nginx에서 제공할 수 있어 현재 FastAPI 배포 구조와 결합이 단순하다.
- 프레임워크가 제공하는 SSR, 서버 액션과 통합 데이터 로딩은 사용하지 않으므로 라우팅·오류 경계·API Client 구성을 팀이 관리해야 한다.
- IndexedDB·OPFS·Web Crypto의 브라우저 차이를 직접 처리해야 한다.
- 기초 단계의 mock 모델은 제품 건강 평가가 아니며 사용자 위험 알림에 사용할 수 없다.

## 재검토 조건

- 공개 페이지 SEO, SSR 또는 서버 렌더링이 제품 핵심 요구가 된다.
- PWA 설치·오프라인 셸·백그라운드 업데이트가 필수가 된다.
- 브라우저 지원 범위 때문에 Vite 기본 빌드 대상이나 Web API 대체 계층이 필요해진다.
- 모델 계약이 안정되고 TypeScript·Rust/WASM·ONNX 중 제품 런타임을 선택할 조건이 충족된다.
- 다중 프론트엔드 패키지가 생겨 npm workspace 또는 다른 패키지 관리 방식이 필요해진다.

## 한 문장 요약

> 이어봄 프론트엔드는 Vite 기반 React SPA로 시작하고, 서버 상태와 브라우저 로컬 건강정보를 서로 다른 계층과 테스트로 강제 분리한다.
