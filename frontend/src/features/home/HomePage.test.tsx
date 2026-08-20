import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { LocalDomainProvider } from "../../app/LocalDomainProvider";
import { HomePage } from "./HomePage";

afterEach(cleanup);

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

  it("가족 구성원 프로필 정보를 수정한다", async () => {
    const user = userEvent.setup();
    renderHomePage();
    await createProfile(user, "나", "본인");

    await user.click(screen.getByRole("button", { name: "프로필 관리" }));
    const nameInput = screen.getByRole("textbox", { name: "이름 또는 호칭" });
    await user.clear(nameInput);
    await user.type(nameInput, "오성민");
    await user.selectOptions(screen.getByRole("combobox", { name: "관계" }), "본인");
    await user.click(screen.getByRole("button", { name: "변경사항 저장" }));

    expect(await screen.findByRole("heading", { name: "오성민님의 건강기록" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("오성민");
  });

  it("프로필과 기록을 보존한 채 숨기고 가족 목록으로 복원한다", async () => {
    const user = userEvent.setup();
    renderHomePage();
    await createProfile(user, "엄마", "부모");

    await user.click(screen.getByRole("button", { name: "프로필 관리" }));
    await user.click(screen.getByRole("button", { name: "목록에서 숨기기" }));
    await user.click(screen.getByRole("button", { name: "프로필 숨기기" }));

    expect(await screen.findByRole("button", { name: "첫 구성원 등록" })).toBeInTheDocument();
    expect(screen.queryByText("엄마")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "숨긴 프로필 1명" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("건강기록은 삭제되지 않았습니다");
    await user.click(screen.getByRole("button", { name: "엄마 프로필 복원" }));

    expect(await screen.findByRole("heading", { name: "엄마님의 건강기록" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("엄마");
    expect(screen.queryByRole("button", { name: "숨긴 프로필 1명" })).not.toBeInTheDocument();
  });

  it("건강기록이 연결된 프로필의 영구 삭제를 거부한다", async () => {
    const user = userEvent.setup();
    renderHomePage();
    await createProfile(user, "아빠", "부모");

    await user.click(screen.getAllByRole("button", { name: "건강기록 작성" })[0]);
    await user.type(screen.getByRole("textbox", { name: "기록 내용" }), "정기 검진 메모");
    await user.click(screen.getByRole("button", { name: "기록 저장" }));
    expect(await screen.findByText("1건")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "프로필 관리" }));
    await user.click(screen.getByRole("button", { name: "빈 프로필 영구 삭제" }));
    await user.click(screen.getByRole("button", { name: "영구 삭제" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "연결된 기록이 있는 프로필은 삭제할 수 없습니다",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("아빠 프로필을 이 브라우저에서 삭제합니다.");
  });

  it("건강기록을 수정하고 삭제 목록에서 복원한다", async () => {
    const user = userEvent.setup();
    renderHomePage();
    await createProfile(user, "나", "본인");
    await user.click(screen.getAllByRole("button", { name: "건강기록 작성" })[0]);
    await user.type(screen.getByRole("textbox", { name: "기록 내용" }), "수정 전 기록");
    await user.click(screen.getByRole("button", { name: "기록 저장" }));
    expect(await screen.findByText("수정 전 기록")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "수정" }));
    const note = screen.getByRole("textbox", { name: "기록 내용" });
    await user.clear(note);
    await user.type(note, "수정 후 기록");
    await user.click(screen.getByRole("button", { name: "변경사항 저장" }));
    expect(await screen.findByText("수정 후 기록")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "삭제" }));
    await user.click(screen.getByRole("button", { name: "삭제 목록으로 이동" }));
    await user.click(await screen.findByRole("button", { name: "삭제된 기록 1건" }));
    await user.click(screen.getByRole("button", { name: "복원" }));
    expect(await screen.findByText("수정 후 기록")).toBeInTheDocument();
  });

  it("구성원별 가족력을 생성하고 수정한다", async () => {
    const user = userEvent.setup();
    renderHomePage();
    await createProfile(user, "자녀", "자녀");
    await user.click(screen.getByRole("button", { name: /가족력 관리/ }));
    await user.click(screen.getByRole("button", { name: "가족력 추가" }));
    await user.type(screen.getByRole("textbox", { name: "친족 관계" }), "외할머니");
    await user.type(screen.getByRole("textbox", { name: "질환명" }), "고혈압");
    await user.click(screen.getByRole("button", { name: "가족력 추가" }));
    expect(await screen.findByText("고혈압")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "수정" }));
    const condition = screen.getByRole("textbox", { name: "질환명" });
    await user.clear(condition);
    await user.type(condition, "당뇨병");
    await user.click(screen.getByRole("button", { name: "변경사항 저장" }));
    expect(await screen.findByText("당뇨병")).toBeInTheDocument();
  });
});

function renderHomePage() {
  render(
    <MemoryRouter>
      <LocalDomainProvider databaseName={`ieobom-home-test-${crypto.randomUUID()}`}>
        <HomePage />
      </LocalDomainProvider>
    </MemoryRouter>,
  );
}

async function createProfile(
  user: ReturnType<typeof userEvent.setup>,
  displayName: string,
  relationship: string,
) {
  await user.click(await screen.findByRole("button", { name: "첫 구성원 등록" }));
  await user.type(screen.getByRole("textbox", { name: "이름 또는 호칭" }), displayName);
  await user.selectOptions(screen.getByRole("combobox", { name: "관계" }), relationship);
  await user.click(screen.getByRole("button", { name: "프로필 저장" }));
  await screen.findByRole("heading", { name: `${displayName}님의 건강기록` });
}
