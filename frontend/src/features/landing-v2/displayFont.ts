/**
 * v2 의 디스플레이 서체(DM Sans)를 **이 페이지에서만** 받는다.
 *
 * ## 왜 전역(`index.html`)에 두지 않나
 *
 * 이 저장소에는 지금까지 웹폰트가 한 장도 없다(`src/styles.css` 는 시스템 스택만
 * 쓴다). 로그인 뒤 화면 전부가 첫 페인트에 외부 요청 하나를 더 기다리게 만들면서
 * 얻는 것이 랜딩 한 장의 서체라면 값이 맞지 않는다. 그래서 링크를 **v2 랜딩이
 * 마운트될 때** 붙인다 — 앱을 쓰는 사람은 이 요청을 한 번도 하지 않는다.
 *
 * ## 왜 한글 서체는 받지 않나
 *
 * 이 페이지의 글은 거의 전부 한글이고, DM Sans 에는 한글 글리프가 없다. 한글은
 * 지금도 앱과 같은 시스템 서체로 떨어지며 **그래야 랜딩과 앱의 글이 같은 얼굴**이다.
 * 여기서 DM Sans 가 실제로 칠하는 것은 숫자와 라틴 문자(167 · mg/dL · D-28)이고,
 * 디자인 시스템이 말하는 "속삭이는 굵기" 가 가장 크게 드러나는 자리도 그쪽이다.
 *
 * ## 폰트가 안 와도 페이지는 완성이다
 *
 * 디자인 시스템의 타이포 성격은 서체 이름이 아니라 **굵기 300~350 · 자간
 * -0.025em · 큰 디스플레이 크기**에서 나온다. 그 셋은 CSS 가 fallback 스택에도
 * 똑같이 건다(`landingV2.css` 의 `--v2-font`). 네트워크가 없거나 이 파일을 지워도
 * 레이아웃과 위계는 그대로다 — `display=swap` 이라 글이 늦게 나타나지도 않는다.
 */

const LINK_ID = "lnv2-display-font";
const HREF = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400&display=swap";

/**
 * `<head>` 에 링크를 한 번 붙인다.
 *
 * 떼지 않는다 — 한 번 받은 서체는 브라우저 캐시에 남고, 뒤로 가기로 다시 들어온
 * 사람이 같은 요청을 또 하는 것이 링크 한 줄보다 비싸다.
 */
export function ensureDisplayFont(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(LINK_ID)) return;

  const link = document.createElement("link");
  link.id = LINK_ID;
  link.rel = "stylesheet";
  link.href = HREF;
  // 서체를 못 받는 환경(오프라인·차단)에서 콘솔만 더럽히지 않게 조용히 접는다.
  link.crossOrigin = "anonymous";
  document.head.append(link);
}
