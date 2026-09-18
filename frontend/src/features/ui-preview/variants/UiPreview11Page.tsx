import { UiPreview7Page } from "./UiPreview7Page";

/**
 * 시안 11: Z-Anatomy 3D 인체 해부도와 실시간 건강 지표가 양방향 연동되는 대화면 캔버스
 * - VanatomeBodyMap 3D 해부학 엔진 전면 중심 배치 (7 colSpan, 600px 높이)
 * - 지표(혈압/혈당/간수치) ↔ 3D 장기(심장/췌장/간/요추) 실시간 양방향 상호작용
 * - 독립 타일 리사이즈 및 밀어내기(Push on Resize) 캔버스 엔진 적용
 */
export function UiPreview11Page() {
  return <UiPreview7Page canvasVariant="3d-focus" />;
}
