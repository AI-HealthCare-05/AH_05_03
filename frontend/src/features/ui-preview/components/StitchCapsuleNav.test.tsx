import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { STITCH_PRIMARY_NAV, StitchCapsuleNav } from "./StitchCapsuleNav";

afterEach(cleanup);

describe("StitchCapsuleNav", () => {
  it("네 화면 순서가 캡슐 바와 같다", () => {
    render(
      <MemoryRouter initialEntries={["/pain-diary"]}>
        <StitchCapsuleNav />
      </MemoryRouter>,
    );

    const links = within(screen.getByRole("navigation", { name: "주 메뉴" })).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(STITCH_PRIMARY_NAV.map((item) => item.label));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/", "/pain-diary", "/assessment", "/health-data"]);
  });

  it("현재 위치는 한 곳만 표시한다", () => {
    render(
      <MemoryRouter initialEntries={["/assessment"]}>
        <StitchCapsuleNav />
      </MemoryRouter>,
    );

    const current = within(screen.getByRole("navigation", { name: "주 메뉴" }))
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("위험 판정 / 리포트");
  });
});
