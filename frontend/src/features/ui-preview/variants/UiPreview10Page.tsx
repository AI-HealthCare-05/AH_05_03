import { UiPreview7Page } from "./UiPreview7Page";

/** 시안 3(독립 블록 캔버스) 기반 + 길이 조절 시 조절 방향으로 타일을 밀어내는 시안 10 */
export function UiPreview10Page() {
  return <UiPreview7Page canvasVariant="push" />;
}
