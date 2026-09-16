# 이어봄 프론트엔드

## 디자인 시스템 준수 규칙 (DESIGN.md SSOT)

프론트엔드 작업(컴포넌트, 스타일, 레이아웃, UI/UX) 시 루트의 [`DESIGN.md`](../DESIGN.md)를 **단일 진실 원천(SSOT)**으로 준수한다.

1. **키 컬러 2개 이하 유지**:
   - Primary Blue: `#1d4fb8` (`--blue-700`), hover `#173d8f` (`--blue-800`), light `#eaf1ff` (`--blue-100`), container `#f4f7ff` (`--blue-50`)
   - Secondary Slate: `#5b687e` (`--muted`), strong `#45536c` (`--muted-strong`)
   - Neutral/Ink: `#172033` (`--ink`), Surface: `#ffffff`, Background: `#f5f7fb`
   - 상태 색상(초록/주황/빨강)은 의학적 선별 판정과 차트에만 제한 사용하며 일반 장식/버튼/UI에 혼용 금지.
2. **타이포그래피 통일**:
   - `Inter, Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
   - 스케일 8단계: Headline(32/24/18px), Body(16/14/12px), Label(13/11px). 임의의 폰트/사이즈 정의 금지.
3. **스켈레톤 UI 표준**:
   - 단순 텍스트("불러오는 중")나 스피너 대신 전역 `Skeleton` 컴포넌트 및 쉬머 애니메이션을 적용한다.
4. **접근성 터치 타깃**:
   - 모든 대화형 요소는 최소 `44px × 44px` 조작 영역 확보.

---

## 공개 랜딩페이지 (`/landing`)

로그인 관문 밖에 있는 소개 화면이다. 구조·재사용 범위·스크롤 구현은 [docs/52 공개 랜딩페이지](../docs/52_landing_page.md)에 있다.

- 코드: `src/features/landing/`
- 건강기록 계층(`useLocalDomain`·`serverApiClient`·`shared/local`)을 **import 하지 않는다.** 화면의 수치는 `landingStory.ts` 의 예시 시나리오 하나뿐이고, 이 경계는 `LandingPage.test.tsx` 가 지킨다.
- 3D 인체·정원·챗봇 런처는 앱이 쓰는 자산(`/vendor/vanatome`, `features/challenge/GardenArt`, `globalHealthAssistant.css`)을 그대로 쓴다. 랜딩용 대체물을 새로 만들지 않는다.
- 디스플레이 타이포 2단과 `landing-*` 표면색은 `DESIGN.md` 에 적혀 있고 **랜딩 밖에서는 쓰지 않는다.**

### 대안 시안 (`/landing-v2`)

같은 이야기를 **다른 디자인 시스템 한 벌**(딥 오버진 단색 · 굵기 300~400 · 100px 캡슐)로 구현한 비교용 화면이다. 배경과 경계, 하나를 고른 뒤 다른 하나를 지우는 방법은 [docs/53 랜딩페이지 v2](../docs/53_landing_page_v2.md)에 있다.

- 코드: `src/features/landing-v2/` — 문구·예시 수치·3D 장면·스크롤 엔진은 전부 `src/features/landing/` 의 **같은 파일**을 쓴다. 다른 것은 표현 계층뿐이다.
- 토큰은 `--v2-*` 로 새로 세우고 앱 토큰을 상속하지 않는다. `landingV2.css` 의 모든 선택자가 `.lnv2-` 를 포함하는 것을 테스트가 지킨다.
- 로그아웃 상태의 `/` 는 **여전히 `/landing`(v1)로 간다.** 정본이 정해지기 전에 기본 동작을 바꾸지 않는다.

---

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

## 현재 Python OCR 테스트 연결

`ocr.py`의 현재 `naver_ocr()` 반환값(`text`, `tables`)을 확인하기 위한 개발용 브리지가 포함되어 있다. 운영에서는 기본적으로 꺼져 있으며 원본과 결과를 PostgreSQL에 저장하지 않는다.

```env
ENABLE_DEV_OCR_BRIDGE=true
NAVER_OCR_URL=네이버_OCR_Invoke_URL
NAVER_OCR_SECRET=네이버_OCR_Secret
```

```bash
uv run uvicorn app.main:app --reload
cd frontend
npm run dev
```

건강기록 작성 화면 오른쪽 아래의 `문서 OCR 테스트` 버튼에서 JPEG 또는 PNG를 선택한다. 출력은 원시 텍스트와 표를 그대로 보여줄 뿐 건강기록으로 자동 변환하거나 확정하지 않는다. `ocr.py`가 정리되거나 브라우저 OCR로 교체되면 `src/ocr/ocr-adapter.ts`의 구현체만 교체한다.
