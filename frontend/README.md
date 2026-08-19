# 이어봄 프론트엔드

Vite 기반 React·TypeScript SPA다. 건강정보는 브라우저 Local Domain 계층에서만 처리하고 FastAPI에는 계정·구독·초대 같은 서비스 메타데이터만 요청한다.

## 실행

    npm install
    npm run dev

## 검증

    npm run lint
    npm run typecheck
    npm test
    npm run build
    npx playwright install chromium
    npm run test:e2e

## 데이터 경계

- src/shared/api: 서비스 메타데이터 HTTP 요청만 허용
- src/shared/local: IndexedDB·OPFS·Web Crypto 어댑터와 로컬 계약
- src/shared/model: 브라우저 로컬 모델 계약과 worker client
- src/workers: 브라우저 worker 실행 코드
- Zustand: 화면 상태만 보관
- TanStack Query: 서버 상태만 보관

현재 모델은 합성 입력을 사용하는 연결 검증용 mock이다. 의료 판정이나 사용자 위험 알림에 사용하지 않는다.
