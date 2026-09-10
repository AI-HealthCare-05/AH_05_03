/**
 * 관문이 지켜야 하는 것 셋.
 *
 * 1. 세션을 확인하는 동안 로그인 화면을 **깜빡이지 않는다** — 이미 로그인한 사용자가
 *    새로고침할 때마다 쫓겨나는 것처럼 보이면 안 된다
 * 2. 로그인 전에는 내비게이션이 없다 — 아무것도 못 하는 문을 세워 두지 않는다
 * 3. 로그인하면 원래 가려던 주소가 그대로 뜬다 — 관문은 리다이렉트가 아니다
 */

/// <reference types="node" />
// `tsconfig.app.json` 은 브라우저 코드용이라 node 타입을 안 싣는다. 이 파일만
// 스타일시트를 파일에서 읽으므로 여기서만 끌어온다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { AuthContext, type AuthContextValue, type AuthStatus } from "./authContext";
import { RootLayout } from "./RootLayout";

// 스타일시트 원문. `import ... from "../styles.css?raw"` 로는 못 읽는다 — vitest 가
// CSS 임포트를 빈 문자열로 갈아 끼워서 조용히 0바이트가 온다(실측). 파일에서 직접
// 읽되 경로는 `import.meta.dirname` 기준이라 실행 위치와 무관하다.
const styleSheet = readFileSync(resolve(import.meta.dirname, "../styles.css"), "utf8");

afterEach(cleanup);

function renderAt(status: AuthStatus, path = "/assessment") {
  const value: AuthContextValue = {
    status,
    email: status === "signed-in" ? "member@example.com" : undefined,
    signIn: async () => {},
    signOut: async () => {},
    markSignedOut: () => {},
  };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<RootLayout />}>
            <Route path="assessment" element={<p>판정 화면 내용</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("RootLayout 로그인 관문", () => {
  it("세션을 확인하는 동안에는 로그인 화면도 본문도 띄우지 않는다", () => {
    renderAt("checking");

    expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "로그인" })).not.toBeInTheDocument();
    expect(screen.queryByText("판정 화면 내용")).not.toBeInTheDocument();
  });

  it("로그인 전에는 로그인 화면만 있고 주 메뉴가 없다", () => {
    renderAt("signed-out");

    expect(screen.getByRole("button", { name: "로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).not.toBeInTheDocument();
    expect(screen.queryByText("판정 화면 내용")).not.toBeInTheDocument();
  });

  it("로그인하면 원래 가려던 주소의 화면이 그대로 뜬다", () => {
    renderAt("signed-in");

    expect(screen.getByText("판정 화면 내용")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
  });

  it("메뉴에 가족 홈·건강 데이터가 있고, 계정은 상단 이메일 링크로 연결된다", () => {
    // **"건강 현황" 은 2026-09-10 에 "건강 데이터" 로 합쳤다.** 판정 스냅샷 추이와
    // 기기 안 기록 추이가 화면 둘로 갈려 있었다 — 하나로 모았다.
    // **주 메뉴에서 '계정' 링크를 빼고 헤더 이메일 링크로 일원화했다.**
    renderAt("signed-in");

    const navigation = screen.getByRole("navigation", { name: "주 메뉴" });
    expect(navigation).toHaveTextContent("가족 홈");
    expect(navigation).toHaveTextContent("건강 데이터");
    expect(navigation).not.toHaveTextContent("챌린지");
    expect(navigation).not.toHaveTextContent("계정");

    const accountLink = screen.getByRole("link", { name: /계정 관리/u });
    expect(accountLink).toHaveAttribute("href", "/account");
  });

  it("메뉴 항목은 전부 앱 안 라우트다 — 죽은 바깥 링크를 두지 않는다", () => {
    renderAt("signed-in");

    const links = within(screen.getByRole("navigation", { name: "주 메뉴" })).getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    // `/api/demo`(예측 데모)가 여기 있었다. FastAPI 가 직접 내던 화면이라 앱 밖
    // 앵커였고, `/assessment` 로 합치면서 라우터와 함께 지웠다. 메뉴에 앱 밖 링크를
    // 다시 두면 그 화면이 사라진 날 죽은 문이 된다 — 실제로 한 번 그랬다.
    for (const link of links) {
      expect(link.getAttribute("href")).not.toMatch(/^\/api\//u);
    }
  });

  it("현재 위치는 한 곳만 표시한다", () => {
    renderAt("signed-in");

    const current = within(screen.getByRole("navigation", { name: "주 메뉴" }))
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("위험 판정");
  });

  /**
   * 실제로 난 CSS 회귀를 여기서 막는다.
   *
   * `.primary-navigation a` 의 선언 블록이 통째로 사라져 선택자가 바로 아래
   * `.active` 규칙에 얹힌 적이 있다. 결과는 **일곱 항목이 전부 활성 색**이고
   * padding·radius 는 0 — 메뉴가 현재 위치를 말하지 못했다.
   *
   * jsdom 은 외부 스타일시트를 적용하지 않아서 렌더로는 잡히지 않는다. 그래서
   * 규칙이 제 몸을 갖고 있는지를 원문에서 확인한다.
   */
  it("기본 메뉴 링크 규칙이 자기 선언 블록을 갖고 있다", () => {
    const blocks = [...styleSheet.matchAll(/\.primary-navigation a\s*\{([^}]*)\}/gu)].map(
      (match) => match[1],
    );

    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((body) => /padding:/u.test(body) && /border-radius:/u.test(body))).toBe(true);
  });

  it("로그인 상태여도 비밀번호 재설정 해시(#reset_token)가 있으면 재설정 관문(SignInPage)을 우선 띄운다", () => {
    window.history.replaceState(null, "", "/assessment#reset_token=test-tok&email=fabxoe.se%40gmail.com");
    renderAt("signed-in", "/assessment#reset_token=test-tok&email=fabxoe.se%40gmail.com");

    expect(screen.getByRole("heading", { name: "새 비밀번호 설정", level: 1 })).toBeInTheDocument();
    expect(screen.queryByText("판정 화면 내용")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).not.toBeInTheDocument();
  });
});
