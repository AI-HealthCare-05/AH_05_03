/**
 * 라우트마다 브라우저 탭 제목을 맞춘다.
 *
 * **왜 필요한가.** `index.html` 의 제목 하나가 끝까지 남아서 일곱 라우트 전부 탭
 * 제목이 같았다(2026-09-10 Orca 브라우저로 확인). `h1` 은 화면마다 올바르게 바뀌는데
 * 제목만 고정이라 세 가지가 깨진다.
 *
 * 1. 탭 여러 개를 열면 어느 탭이 어느 화면인지 구분되지 않는다
 * 2. 북마크·방문 기록이 전부 같은 이름으로 쌓인다
 * 3. 스크린리더가 화면 전환을 알리지 못한다 — SPA 는 문서가 바뀌지 않으므로
 *    제목 변경이 사실상 유일한 전환 신호다
 *
 * **왜 `useMatches` 를 안 쓰나.** 라우트 정의의 `handle` 에서 제목을 읽는 것이
 * 먼저 떠오르는 방법인데, `useMatches` 는 **데이터 라우터 안에서만** 동작하고 밖에서
 * 부르면 예외를 던진다. `RootLayout.test.tsx` 와 `SignUpPage.test.tsx` 는 `MemoryRouter`
 * 로 렌더하므로 그 길로 가면 컴포넌트가 테스트에서 통째로 죽는다 — 제목 하나 때문에
 * 컴포넌트를 라우터 종류에 묶는 셈이다.
 *
 * 그래서 **경로로 찾는다.** `useLocation` 은 어느 라우터에서나 동작하고, 제목의
 * 원천은 `RootLayout` 이 이미 들고 있는 내비 표다 — 그 라벨이 곧 사용자가 아는
 * 화면 이름이라 제목을 따로 적어 둘 필요가 없다.
 */

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** 탭 제목 뒤에 붙는 서비스 이름. `index.html` 의 제목과 같은 표기를 쓴다. */
export const TITLE_SUFFIX = "이어봄";

/** 경로 하나와 그 화면의 이름. `RootLayout` 의 내비 항목이 그대로 들어온다. */
export type TitleRoute = { readonly to: string; readonly label: string };

/**
 * `pathname` 에 맞는 이름을 고른다. **가장 긴 접두사가 이긴다.**
 *
 * `/challenge/today` 처럼 내비에 없는 하위 경로는 `/challenge` 의 이름을 쓴다 —
 * 하위 화면마다 이름을 따로 적지 않아도 탭이 "챌린지" 로 구분된다. `/` 는 모든
 * 경로의 접두사라 정확히 일치할 때만 쓴다.
 */
export function titleForPath(pathname: string, routes: readonly TitleRoute[]): string | undefined {
  const matched = routes
    .filter((route) => (route.to === "/" ? pathname === "/" : pathname.startsWith(route.to)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return matched?.label;
}

/** 제목을 직접 정하는 화면용. 내비에 없는 화면(가입 등)이 쓴다. */
export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${TITLE_SUFFIX}` : TITLE_SUFFIX;
  }, [title]);
}

/** 현재 경로에 맞는 제목을 반영한다. 맞는 이름이 없으면 서비스 이름만 남는다. */
export function useRouteTitle(routes: readonly TitleRoute[]): void {
  const { pathname } = useLocation();
  useDocumentTitle(titleForPath(pathname, routes));
}
