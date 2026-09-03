import { render, screen } from "@testing-library/react";
import { Outlet, RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ErrorPage } from "./ErrorPage";

/**
 * react-router 는 `errorElement` 가 없으면 자기 기본 화면을 띄운다. 거기에는
 * "Unexpected Application Error!" 와 "💿 Hey developer 👋 ... errorElement prop"
 * 이 그대로 찍힌다 — 개발자에게 하는 말이 사용자 화면에 나가는 것이고, 실제로
 * `/demo` 를 친 사용자가 그 화면을 봤다.
 *
 * 그 문구가 다시 새는지는 눈으로 확인할 수 없다. 라우터 설정을 누가 건드리면
 * 조용히 돌아오기 때문에 검사로 못 박는다.
 */
function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        // `RootLayout` 과 같은 모양이어야 한다 — Outlet 이 없으면 자식 라우트가
        // 아예 렌더되지 않아서 검사가 앱이 아니라 검사 자신을 재게 된다.
        element: (
          <div>
            <Outlet />
          </div>
        ),
        errorElement: <ErrorPage />,
        children: [
          { index: true, element: <div>홈</div> },
          { path: "*", element: <ErrorPage /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

describe("ErrorPage", () => {
  it("없는 경로에서 사용자 언어로 안내한다", () => {
    renderAt("/없는페이지");

    expect(screen.getByRole("heading", { name: "찾으시는 페이지가 없습니다" })).toBeInTheDocument();
    // 막다른 길을 만들지 않는다. 나갈 길이 항상 두 개 있어야 한다.
    expect(screen.getByRole("link", { name: "홈으로 가기" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: "이전으로" })).toBeInTheDocument();
  });

  it("react-router 기본 개발자 문구가 새지 않는다", () => {
    const { container } = renderAt("/demo");

    expect(container.textContent).not.toContain("Unexpected Application Error");
    expect(container.textContent).not.toContain("Hey developer");
    expect(container.textContent).not.toContain("errorElement");
  });

  it("기록은 안전하다고 분명히 말한다", () => {
    // 이 파일은 렌더를 정리하지 않으므로 screen 이 아니라 이번 렌더의 container 로
    // 좁혀서 본다. screen 을 쓰면 앞 검사가 남긴 노드까지 걸려 "여러 개 찾았다" 로 깨진다.
    const { container } = renderAt("/없는경로");

    // 건강 기록을 다루는 화면이라 "내 데이터가 날아갔나" 가 첫 반응이 된다.
    expect(container.textContent).toContain("기록은 그대로 기기에 남아 있습니다");
  });
});
