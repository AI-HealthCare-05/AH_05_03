import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

/**
 * jsdom 에 없는 두 가지를 채운다.
 *
 * 브라우저에는 항상 있고 프로덕션 코드가 당연히 부르는 것들이라, `?.` 로 감싸
 * **제품 코드를 테스트 환경에 맞춰 굽히지 않는다.** 대신 없는 쪽을 여기서 채운다.
 *
 * - `scrollIntoView`: jsdom 은 레이아웃이 없어 아예 정의하지 않는다. 부르면 죽는다.
 * - `matchMedia`: 마찬가지로 없다. `prefers-reduced-motion` 은 기본값(줄이지 않음)으로 답한다.
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
