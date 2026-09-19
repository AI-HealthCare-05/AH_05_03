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

/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { router } from "./router";

/**
 * 관문 밖에 서 있어도 되는 화면. 늘리려면 여기와 함께 이유를 적는다.
 *
 * - `/signup` 가입. 링크로 건네야 하고, 기기 안 건강기록을 읽지 않는다.
 * - `/landing` 공개 소개 페이지. 같은 조건이다 — `features/landing` 은
 *   `useLocalDomain` 도 `serverApiClient` 도 부르지 않고 예시 시나리오만 그린다.
 *   그 조건은 `features/landing/LandingPage.test.tsx` 가 따로 지킨다.
 * - `/landing-v2` 예전 캡슐 시안 주소. 화면이 아니라 `/landing` 으로 보낸다.
 * - `/wall/pair` · `/wall` 공용 벽. 마스터 로그인 세션 없이 기기 토큰만 쓰고
 *   `useLocalDomain` 으로 건강기록을 읽지 않는다. `WallPairPage.test.tsx` 가 지킨다.
 */
const OUTSIDE_THE_GATE = [
  "/signup",
  "/landing",
  "/landing-v2",
  "/wall/pair",
  "/wall",
];

describe("라우트 표", () => {
  it("관문 밖에 있는 것은 가입·소개·벽 화면들뿐이다", () => {
    const layout = router.routes.filter((route) => route.path === "/");
    expect(layout).toHaveLength(1);

    const outside = router.routes
      .filter((route) => route.path !== "/")
      .map((route) => route.path);
    // 가입은 링크로 건네야 해서 주소가 필요하고, 기기 안 건강기록을 읽지 않는다.
    // 그 조건을 못 갖춘 화면이 여기 늘면 로그인 없이 열리는 문이 하나 더 생긴다.
    expect(outside).toEqual(OUTSIDE_THE_GATE);
  });

  it("나머지 화면은 전부 그 레이아웃 아래에 있다", () => {
    const layout = router.routes.find((route) => route.path === "/");
    const children = layout?.children ?? [];
    expect(children.length).toBeGreaterThan(1);

    const paths = children.map((route) => route.path);
    // 랜딩 「로그인」이 가리키는 주소. 관문 뒤에 있어야 로그인 폼이 뜬다.
    expect(paths).toContain("signin");
    // 예전에 관문 밖에 서 있던 화면. 다시 나가면 여기서 걸린다.
    expect(paths).toContain("ui-preview");
    // 레이아웃 안에서 잡는 404 도 관문 뒤에 있어야 한다.
    expect(paths).toContain("*");
  });

  it("공개 기본 /landing 은 차트 히어로 페이지이고 캡슐 시안이 아니다", () => {
    const source = readFileSync(resolve(import.meta.dirname, "router.tsx"), "utf8");
    const landingBlock = source.slice(source.indexOf('path: "/landing"'), source.indexOf('path: "/landing-v2"'));
    expect(landingBlock).toMatch(/<LandingPage \/>/u);
    expect(source).not.toMatch(/LandingV2Page/u);
    expect(source).not.toMatch(/features\/landing-v2/u);
  });

  it("예전 /landing-v2 주소는 소개 페이지로 보낸다", () => {
    const source = readFileSync(resolve(import.meta.dirname, "router.tsx"), "utf8");
    const v2Block = source.slice(source.indexOf('path: "/landing-v2"'));
    expect(v2Block).toMatch(/<Navigate to="\/landing" replace \/>/u);
  });
});
