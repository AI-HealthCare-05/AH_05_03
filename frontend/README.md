# 이어봄 프론트엔드

## 건강기록 등록

Manyfast의 `F-HTRDKQ 건강 기록 등록`과 상세 명세 4개를 구현한 첫 로컬 도메인 화면이다.

- 통합 기록 작성 화면에서 구성원과 기록 유형을 선택한다.
- 수치형 건강 지표, 예방접종·검진, 생활 기록, 전문 검사·기타를 직접 입력한다.
- 기록 유형별 형식과 범위를 검증한다. 정상/이상 여부나 진단은 판단하지 않는다.
- 동일한 구성원·기록 시각·유형·내용의 중복을 확인하고 사용자 선택 후 저장한다.
- payload와 중복 탐지용 해시는 AES-GCM으로 암호화하여 `ieobom-local` IndexedDB에 저장한다.
- 저장과 동시에 `changeEvents`에 생성 이력을 기록한다.
- 서버 API 및 PostgreSQL로 건강정보를 전송하지 않는다.
- OCR은 아직 연결하지 않았으며 이번 화면에서 생성되는 기록의 source는 `manual`이다.

현재 `App.tsx`의 구성원은 로컬 프로필 기능이 합쳐지기 전 화면 확인용 데이터다. 프로필 기능 병합 후 `HealthRecordForm`의 `profiles`와 `householdId` props에 실제 로컬 프로필 조회 결과를 전달한다.

```bash
cd frontend
npm install
npm run dev
```

브라우저 개발자 도구의 Application → IndexedDB → `ieobom-local`에서 암호화된 레코드와 변경 이력을 확인할 수 있다. DBeaver는 PostgreSQL 서버 데이터용이므로 로컬 건강기록은 표시하지 않는다.
