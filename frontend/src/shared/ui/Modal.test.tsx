/**
 * 공용 모달이 지켜야 하는 것.
 *
 * 겹쳐 뜨는 자리가 실제로 있다 — 기록 모달 위에 판정 근거 모달. 그 상태에서
 * **Escape 한 번에 둘 다 닫히면 안 된다.** 사용자는 근거만 닫고 기록으로 돌아가려던
 * 것이다.
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Modal } from "./Modal";

afterEach(cleanup);

function Stacked() {
  const [outer, setOuter] = useState(true);
  const [inner, setInner] = useState(false);
  return (
    <>
      {outer ? (
        <Modal title="바깥" onClose={() => setOuter(false)}>
          <button type="button" onClick={() => setInner(true)}>
            안쪽 열기
          </button>
        </Modal>
      ) : null}
      {inner ? <Modal title="안쪽" onClose={() => setInner(false)} /> : null}
    </>
  );
}

describe("Modal", () => {
  it("Escape 는 맨 위 모달만 닫는다", async () => {
    const user = userEvent.setup();
    render(<Stacked />);

    await user.click(screen.getByRole("button", { name: "안쪽 열기" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(2);

    await user.keyboard("{Escape}");
    // 안쪽만 닫히고 바깥은 남는다.
    const remaining = screen.getAllByRole("dialog");
    expect(remaining).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "바깥" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("겹친 모달을 닫아도 뒤 페이지 스크롤은 잠긴 채로 남는다", async () => {
    const user = userEvent.setup();
    render(<Stacked />);

    await user.click(screen.getByRole("button", { name: "안쪽 열기" }));
    await user.keyboard("{Escape}");

    // 바깥이 아직 열려 있으므로 잠금이 풀리면 안 된다.
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });

  it("배경을 누르면 닫히고, 패널 안에서 시작한 드래그는 닫지 않는다", async () => {
    const user = userEvent.setup();
    render(<Stacked />);

    // 패널 안에서 누르고 배경에서 떼는 것은 글자 선택이지 닫기가 아니다.
    await user.pointer([
      { keys: "[MouseLeft>]", target: screen.getByRole("dialog") },
      { keys: "[/MouseLeft]", target: document.querySelector(".modal-backdrop") as HTMLElement },
    ]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(document.querySelector(".modal-backdrop") as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
