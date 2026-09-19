/** 제품 홈(`/`)과 시안 주소는 자체 상단 바를 그려 RootLayout 헤더를 겹치지 않는다. */
export function isPreviewShellPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "") return true;
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
