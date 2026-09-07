/**
 * 라우트 표가 지켜야 하는 것 하나 — **로그인 관문 밖에 화면을 두지 않는다.**
 *
 * 관문은 `RootLayout` 이 `Outlet` 대신 로그인 화면을 그리는 방식이라, 레이아웃의
 * 자식이 아닌 라우트는 관문을 통째로 건너뛴다. `/ui-preview` 가 실제로 그랬고
 * 그 화면은 `useLocalDomain()` 으로 기기 안 프로필과 건강기록을 읽는다 —
 * 로그인하지 않은 사람이 주소만 치면 그게 그대로 보였다.
 *
 * 내비게이션에서 링크를 빼는 것으로는 막히지 않는다(주소는 살아 있다). 그래서
 * 표 자체를 시험한다.
 */

import { describe, expect, it } from "vitest";

import { router } from "./router";

/** 관문 밖에 서 있어도 되는 화면. 늘리려면 여기와 함께 이유를 적는다. */
const OUTSIDE_THE_GATE = ["/signup"];

describe("라우트 표", () => {
  it("관문 밖에 있는 것은 가입 화면 하나뿐이다", () => {
    const layout = router.routes.filter((route) => route.path === "/");
    expect(layout).toHaveLength(1);

    const outside = router.routes.filter((route) => route.path !== "/").map((route) => route.path);
    // 가입은 링크로 건네야 해서 주소가 필요하고, 기기 안 건강기록을 읽지 않는다.
    // 그 조건을 못 갖춘 화면이 여기 늘면 로그인 없이 열리는 문이 하나 더 생긴다.
    expect(outside).toEqual(OUTSIDE_THE_GATE);
  });

  it("나머지 화면은 전부 그 레이아웃 아래에 있다", () => {
    const layout = router.routes.find((route) => route.path === "/");
    const children = layout?.children ?? [];
    expect(children.length).toBeGreaterThan(1);

    const paths = children.map((route) => route.path);
    // 예전에 관문 밖에 서 있던 화면. 다시 나가면 여기서 걸린다.
    expect(paths).toContain("ui-preview");
    // 레이아웃 안에서 잡는 404 도 관문 뒤에 있어야 한다.
    expect(paths).toContain("*");
  });
});
