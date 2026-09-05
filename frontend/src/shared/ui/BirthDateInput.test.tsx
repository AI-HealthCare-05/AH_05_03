import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { BirthDateInput } from "./BirthDateInput";

afterEach(cleanup);

describe("BirthDateInput", () => {
  it("연도와 월의 자릿수가 채워지면 다음 입력 칸으로 이동한다", async () => {
    const user = userEvent.setup();
    render(<BirthDateInput />);

    const year = screen.getByRole("textbox", { name: "생년월일 연도" });
    const month = screen.getByRole("textbox", { name: "생년월일 월" });
    const day = screen.getByRole("textbox", { name: "생년월일 일" });

    await user.type(year, "2006");
    expect(month).toHaveFocus();

    await user.type(month, "09");
    expect(day).toHaveFocus();
  });

  it("세 칸을 기존 YYYY-MM-DD 폼 값으로 합친다", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <BirthDateInput />
      </form>,
    );

    await user.type(screen.getByRole("textbox", { name: "생년월일 연도" }), "2006");
    await user.type(screen.getByRole("textbox", { name: "생년월일 월" }), "09");
    await user.type(screen.getByRole("textbox", { name: "생년월일 일" }), "06");

    expect(new FormData(container.querySelector("form")!).get("birthDate")).toBe("2006-09-06");
  });

  it("수정 화면의 기존 날짜를 각 칸에 채운다", () => {
    render(<BirthDateInput defaultValue="1988-12-31" />);

    expect(screen.getByRole("textbox", { name: "생년월일 연도" })).toHaveValue("1988");
    expect(screen.getByRole("textbox", { name: "생년월일 월" })).toHaveValue("12");
    expect(screen.getByRole("textbox", { name: "생년월일 일" })).toHaveValue("31");
  });
});
