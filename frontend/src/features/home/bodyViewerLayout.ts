/** preview18 서랍: left 12px + width 320px. */
export const DRAWER_INSET_PX = 12;
export const DRAWER_PANEL_WIDTH_PX = 320;
export const HINT_CLEARANCE_PX = 40;
/** 서랍 자동 개방보다 먼저 확대 아이콘을 우측 하단으로 보낸다. */
export const FOCUS_DOCK_LEAD_PX = 168;
/** 힌트가 없을 때 도킹 계산용 최소 너비. */
export const TYPICAL_HINT_WIDTH_PX = 360;
export const WIDE_BODY_VIEWER_MIN_HEIGHT_PX = 360;

export function drawerOccupiesLeftPx(): number {
  return DRAWER_INSET_PX + DRAWER_PANEL_WIDTH_PX;
}

/** 가운데 힌트 바가 열린 서랍 오른쪽보다 오른쪽에 있으려면 필요한 뷰어 너비. */
export function requiredViewerWidthToClearHint(hintWidth: number): number {
  const occupied = drawerOccupiesLeftPx() + HINT_CLEARANCE_PX;
  return 2 * occupied + Math.max(0, hintWidth);
}

export function canOpenDrawerWithoutCoveringHint(
  viewerWidth: number,
  viewerHeight: number,
  hintWidth: number,
): boolean {
  if (hintWidth <= 0 || viewerHeight < WIDE_BODY_VIEWER_MIN_HEIGHT_PX) return false;
  return viewerWidth >= requiredViewerWidthToClearHint(hintWidth);
}

export function shouldDockFocusIcons(
  viewerWidth: number,
  viewerHeight: number,
  hintWidth: number,
): boolean {
  if (viewerHeight < WIDE_BODY_VIEWER_MIN_HEIGHT_PX) return false;
  const hint = hintWidth > 0 ? hintWidth : TYPICAL_HINT_WIDTH_PX;
  return viewerWidth >= requiredViewerWidthToClearHint(hint) - FOCUS_DOCK_LEAD_PX;
}

export function invertFocusBarFlip(
  previous: { left: number; top: number },
  next: { left: number; top: number },
): { dx: number; dy: number } {
  return {
    dx: previous.left - next.left,
    dy: previous.top - next.top,
  };
}
