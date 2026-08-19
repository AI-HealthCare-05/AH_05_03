import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { LocalDomainProvider } from "../../app/LocalDomainProvider";
import { UiPreviewPage } from "./UiPreviewPage";

describe("UiPreviewPage", () => {
  it("구성원과 건강기록을 같은 로컬 도메인에 저장한다", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LocalDomainProvider databaseName={`ieobom-ui-preview-${crypto.randomUUID()}`}>
          <UiPreviewPage />
        </LocalDomainProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "가족 건강 기록" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "구성원 등록" }));
    await user.type(screen.getByRole("textbox", { name: "이름 또는 호칭" }), "나");
    await user.selectOptions(screen.getByRole("combobox", { name: "관계" }), "본인");
    await user.click(screen.getByRole("button", { name: "등록" }));

    expect(await screen.findByRole("heading", { name: "나님의 기록" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "기록 추가" }));
    await user.clear(screen.getByRole("textbox", { name: "기록 내용" }));
    await user.type(screen.getByRole("textbox", { name: "기록 내용" }), "오늘 컨디션 양호");
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("오늘 컨디션 양호")).toBeInTheDocument();
  });
});
