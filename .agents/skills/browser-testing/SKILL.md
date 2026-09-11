---
name: browser-testing
description: "Deep browser E2E QA and verification intelligence. Use this skill when testing web pages, auditing DevTools (Console, Network, DOM), detecting soft errors (silent failures, React warnings, dead clicks), checking network overhead (over-fetching, duplicate API calls), analyzing 3D WebGL render load, and validating responsive layouts with browser_subagent."
---

# browser-testing

WebArena, Browserbase Stagehand, Cucumber Gherkin의 업계 표준을 결합한 **브라우저 심층 E2E QA & 성능 감사 엔진**이다.

단순히 화면이 뜨는지 확인하는 수박 겉핥기식 테스트를 넘어, 크롬의 **네트워크(Network), 콘솔(Console), 엘리먼트(DOM/A11y), 3D WebGL 렌더링 부하 및 소프트 에러(소리 없는 실패)**까지 모조리 전수 조사한다.

---

## 1. 4대 심층 진단 엔진 (The 4 Deep Audits)

### ① 콘솔 & 소프트 에러 감사 (Console & Soft Error Audit)
* **[MUST] Rule 201: `console.error` 0건 원칙**
  - 테스트 중 단 1건의 `console.error` 또는 처리되지 않은 예외(Uncaught Exception)도 허용하지 않는다.
* **[MUST] Rule 202: 콘솔 경고(`console.warn`) 전수 포착**
  - React의 고질적인 소프트 에러: `Each child in a list should have a unique 'key' prop`, `Hydration failed because the initial UI does not match`, `Can't perform a React state update on an unmounted component`.
  - Deprecated API 경고 및 비동기 Promise Unhandled Rejection을 수집하여 리포트에 명시한다.

### ② 네트워크 부하 & 오버페칭 감사 (Network Overhead Audit)
* **[MUST] Rule 203: 단일 행위당 API 호출 수 제한 (오버페칭 방지)**
  - 버튼을 한 번 누르거나 특정 탭을 열었을 때, 동일한 엔드포인트가 2초 이내에 2회 이상 중복 호출되면 안 된다 (중복 렌더링 / useEffect 무한 루프 탐지).
* **[MUST] Rule 204: 소리 없는 API 실패(Silent Catch) 탐지**
  - 화면에는 "데이터가 없습니다"라고 정상처럼 나오더라도, 네트워크 탭에서 `4xx`, `5xx` 응답이 발생했다면 반드시 '실패'로 판정한다.
* **[SHOULD] Rule 205: API 계약 및 헤더 검증**
  - 신규 생성 요청(`POST`)은 `201 Created`와 `Location` 헤더를 반환하는지 확인한다.
  - 모든 백엔드 응답 헤더에 `X-Request-ID`가 존재하는지 확인한다.

### ③ 3D 렌더링 & GPU 부하 감사 (3D WebGL & Performance Audit)
* **[MUST] Rule 206: 3D 캔버스 로딩 지연 한계 (Time to Interactive)**
  - Three.js/WebGL 캔버스는 페이지 진입 후 3초 이내에 초기 메쉬 로딩 및 렌더링을 마쳐야 한다.
* **[MUST] Rule 207: 무한 렌더 루프 수렴(정지) 검증 (Idle FPS Stabilization)**
  - 3D 장기 펄스 애니메이션이나 카메라 회전이 끝난 후, 정적 상태에서는 지속적인 CPU/GPU 낭비 루프가 멈추고 유휴(Idle) 상태로 수렴해야 한다.
  - 마우스 드래그나 인터랙션이 없을 때 불필요한 고속 재렌더링이 발생하면 안 된다.

### ④ 엘리먼트 & 레이아웃 감사 (DOM & Layout Audit)
* **[MUST] Rule 208: 데드 클릭(Dead Click) 탐지**
  - 클릭 가능한 요소(버튼, 링크, 토글)를 클릭했을 때 300ms 이내에 시각적 피드백(로딩 스켈레톤, 모달 열림, 활성 상태 변경 등)이 반드시 나타나야 한다.
* **[MUST] Rule 209: 텍스트 오버플로우 및 잘림 검사**
  - 모바일 뷰포트(519px) 및 일반 해상도에서 텍스트가 컨테이너 밖으로 삐져나가거나, 중요한 정보가 의도치 않게 잘려 숨겨지지 않는지 확인한다.
* **[SHOULD] Rule 210: 터치 타깃 44px 이상 준수**
  - 모바일 터치 가능한 모든 인터랙티브 요소는 최소 44×44px 이상의 면적을 확보해야 한다.

### ⑤ 콘솔 원본 증빙 & 무결성 강제 (Console Integrity & Anti-Hallucination)
* **[MUST] Rule 211: 원본 콘솔 로그 덤프 필수 인용 (추측 보고 절대 금지)**
  - AI는 "에러 0건 (클린)"이라는 정성적 요약 문구만 적어서는 안 된다.
  - 반드시 브라우저 도구(`read_console_logs` 또는 Playwright)가 수집한 **원천 콘솔 로그 덤프(에러 텍스트, 경고 텍스트, 위치 URL)를 리포트 본문에 코드 블록으로 그대로 인용**해야 한다. 원본 로그 증빙이 누락된 보고서는 무효(Invalid)로 처리한다.
* **[MUST] Rule 212: 크롬 DevTools 배지(Errors/Issues) 전수 대조**
  - 크롬 브라우저 콘솔 배지에 표시되는 `❌ Errors`와 `💬 Issues`가 1건이라도 존재할 경우, 단순 무시하지 않고 다음 4대 카테고리로 분류하여 소명해야 한다:
    1. **네트워크 리소스 에러**: 누락된 GLB 메쉬, 정적 에셋 404, API 4xx/5xx
    2. **보안/CSP 위반**: 외부 스크립트 차단, 인라인 스크립트 에러
    3. **WebGL / GPU Stall**: `GPU stall due to ReadPixels`, 셰이더 컴파일 오류
    4. **프레임워크 소프트에러**: React Key 미지정, Hydration 불일치, State 누수
* **[MUST] Rule 213: 인터랙션 전후 콘솔 누적 추적**
  - 초기 진입 시점뿐 아니라 버튼 클릭, 탭 전환, 챗봇 전송 등 각 사용자 액션 직후 발생한 에러를 누적하여 기록한다.

---

## 2. `browser_subagent` 자율 구동 프로토콜

AI는 본 스킬을 실행할 때 다음 표준 규격에 따라 `browser_subagent`를 호출한다:

1. **녹화 파일명 (`RecordingName`)**: `qa_<시나리오명>_<타임스탬프>` (소문자/언더스코어, WebP 자동 녹화).
2. **시나리오 주입**: `.agents/skills/browser-testing/scenarios/` 아래의 Gherkin 시나리오를 읽어 빠짐없이 태스크에 주입.
3. **결과 수집**:
   - `read_console_logs`: 콘솔 에러 및 경고 목록 확보
   - `take_screenshot`: 최종 화면 및 주요 인터랙션 시점 캡처
   - 최종 요약 리포트 작성

---

## 3. 표준 결과 리포트 출력 포맷

테스트 완료 후 AI는 반드시 아래 마크다운 표 형식으로 결과를 보고한다:

```markdown
### 🎯 브라우저 심층 QA 결과 리포트: [시나리오명]

| 영역 | 검사 항목 | 판정 | 세부 내용 |
|---|---|---|---|
| **콘솔 (Console)** | `console.error` 0건 | ✅ 통과 | 에러 0건 확인 |
| | `console.warn` 소프트에러 | ⚠️ 주의 | React Key 중복 경고 1건 발견 (`ProfileList.tsx:42`) |
| **네트워크 (Network)** | API 호출 수 & 중복 난사 | ✅ 통과 | 총 3회 호출 (단일 액션 중복 호출 0건) |
| | 상태 코드 (2xx/3xx) | ✅ 통과 | 4xx/5xx 소리 없는 실패 0건 |
| | 추적 헤더 (`X-Request-ID`) | ✅ 통과 | 전 응답 헤더 탑재 확인 |
| **3D & 렌더링** | Three.js 캔버스 초기 로딩 | ✅ 통과 | 1.2초 내 렌더링 완료 |
| | 애니메이션 수렴 (Idle) | ✅ 통과 | 펄스 3회 후 렌더 루프 정상 정지 |
| **DOM & 레이아웃** | 데드 클릭 및 반응성 | ✅ 통과 | 클릭 즉시 팝오버 렌더링 (120ms) |
| | 텍스트 잘림 및 반응형 | ✅ 통과 | 519px 모바일 뷰 오버플로우 없음 |

* 🎬 **전체 과정 녹화 비디오**: `[비디오 파일명](file:///...)`
* 📸 **최종 상태 스크린샷**:
![최종 화면](file:///...)
```

---

## 4. 시나리오 카탈로그

* [`scenarios/01_home_3d_monitoring.md`](scenarios/01_home_3d_monitoring.md): 홈 대시보드 진입, 3D 장기 뷰어 렌더링 부하/수렴, API 호출수 감사
* [`scenarios/02_chatbot_assistant_flow.md`](scenarios/02_chatbot_assistant_flow.md): 봄이 건강비서 플로팅 위젯 대화, 스켈레톤 UI, API 중복호출 방지
* [`scenarios/03_responsive_mobile_layout.md`](scenarios/03_responsive_mobile_layout.md): 519px 모바일 뷰포트 반응형, 텍스트 오버플로우, 터치 타깃 검증
