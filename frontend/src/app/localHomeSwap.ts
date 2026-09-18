/** nginx 배포 번들에서 시안 18을 `/`에, vite 개발(`/`·5173)에서 기존 홈을 `/`에 둔다. */
export const LOCAL_HOME_IS_PREVIEW18 = !import.meta.env.DEV;

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
