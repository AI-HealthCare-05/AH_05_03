import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { FamilySharingSection } from "./FamilySharingSection";
import { INITIAL_SHARE_CATEGORIES, applySharePreset } from "./familySharingPreview";

afterEach(cleanup);

describe("applySharePreset", () => {
  it("시니어 모드는 혈압·혈당·복약만 연다", () => {
    const next = applySharePreset(INITIAL_SHARE_CATEGORIES, "senior");
    const open = next.filter((category) => category.isEnabled).map((category) => category.id);
    expect(open).toEqual(["bp_hr", "glucose_cgm", "prescription_timeline"]);
  });

  it("프라이버시 모드는 전부 끈다", () => {
    const next = applySharePreset(INITIAL_SHARE_CATEGORIES, "privacy");
    expect(next.every((category) => !category.isEnabled && category.allowedMemberIds.length === 0)).toBe(true);
  });
});

describe("FamilySharingSection", () => {
  it("6개 항목과 프리셋을 그리고 공유를 끌 수 있다", async () => {
    const user = userEvent.setup();
    render(<FamilySharingSection />);

    expect(screen.getByRole("heading", { name: /관리 중인 건강 항목/ })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "혈압 및 심박수 연속 모니터링 공유" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("switch", { name: "혈압 및 심박수 연속 모니터링 공유" }));
    expect(screen.getByRole("switch", { name: "혈압 및 심박수 연속 모니터링 공유" })).toHaveAttribute("aria-checked", "false");

    await user.click(screen.getByRole("button", { name: "프라이버시 강화 모드" }));
    expect(screen.getByText("프라이버시 강화 모드를 적용했습니다.")).toBeTruthy();
    expect(screen.getAllByRole("switch").every((node) => node.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("열람 대상을 모달에서 저장한다", async () => {
    const user = userEvent.setup();
    render(<FamilySharingSection />);

    const glucoseCard = screen.getByRole("heading", { name: "공복 혈당 및 당화혈색소 추이" }).closest("article");
    expect(glucoseCard).toBeTruthy();
    await user.click(within(glucoseCard as HTMLElement).getByRole("button", { name: "+ 대상 변경" }));
    await user.click(screen.getByRole("checkbox", { name: /부친 오진철/ }));
    await user.click(screen.getByRole("button", { name: "대상 저장" }));
    expect(screen.getByText("열람 대상을 저장했습니다.")).toBeTruthy();
    expect(within(glucoseCard as HTMLElement).getByText("부친 오진철")).toBeTruthy();
  });
});
