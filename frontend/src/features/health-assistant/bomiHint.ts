/** 화면 안 고정 설명 대신, 봄이 런처 말풍선으로 같은 말을 전한다. */
export function tellBomi(text: string) {
  window.dispatchEvent(new CustomEvent("ieobom:bomi-hint", { detail: { text } }));
}

export function hushBomi() {
  window.dispatchEvent(new CustomEvent("ieobom:bomi-hint-clear"));
}
