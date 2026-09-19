/** 시안 18(새 UI)을 기본 홈(`/`)에 두고, 기존 가족 홈은 `/ui-preview18`에 둔다. */
export const LOCAL_HOME_IS_PREVIEW18 = true;

export function isPreviewShellPath(pathname: string): boolean {
  if (LOCAL_HOME_IS_PREVIEW18) {
    if (pathname === "/" || pathname === "") return true;
    if (pathname === "/ui-preview18") return false;
  }
  return pathname.startsWith("/ui-preview");
}

/** 시안 비교 바는 명시적인 `/ui-preview*` 주소에서만 보여 준다. */
export function isVariantBarPath(pathname: string): boolean {
  return pathname.startsWith("/ui-preview");
}

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** 가족 홈과 같은 StitchAppHeader 를 쓰는 제품 화면. */
export function isStitchShellPath(pathname: string): boolean {
  return (
    matchesRoute(pathname, "/pain-diary") ||
    matchesRoute(pathname, "/assessment") ||
    matchesRoute(pathname, "/health-data3") ||
    matchesRoute(pathname, "/account")
  );
}
