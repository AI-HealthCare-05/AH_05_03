import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { LocalDomainProvider } from "../../app/LocalDomainProvider";
import { HomePage } from "./HomePage";

describe("HomePage", () => {
  it("로컬 프로필을 생성하고 제품 대시보드에 표시한다", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LocalDomainProvider databaseName={`ieobom-home-test-${crypto.randomUUID()}`}>
          <HomePage />
        </LocalDomainProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "가족의 건강 흐름을 한곳에서 이어보세요" }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "첫 구성원 등록" }));

    await user.type(screen.getByRole("textbox", { name: "이름 또는 호칭" }), "나");
    await user.selectOptions(screen.getByRole("combobox", { name: "관계" }), "본인");
    await user.click(screen.getByRole("button", { name: "프로필 저장" }));

    expect(await screen.findByRole("heading", { name: "나님의 건강기록" })).toBeInTheDocument();
    expect(screen.getByText("암호화 로컬 저장")).toBeInTheDocument();
  });
});
