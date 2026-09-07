/**
 * 검진표 패널이 지켜야 하는 것.
 *
 * 1. 고른 파일은 **암호화 보관함에 먼저** 들어간다 — 인식이 실패해도 원본은 남는다
 * 2. 관문을 통과한 수치만 폼으로 간다 — `review` 는 넘기지 않는다
 * 3. 걸러 낸 행은 **원문 4열과 함께** 화면에 남는다 — 그게 없으면 사용자가 표의
 *    어느 줄인지 짚지 못한다
 */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GeminiOcrAdapter } from "../../shared/api/geminiOcrAdapter";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
import { DocumentPane } from "./DocumentPane";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const RECOGNIZED = {
  text: "검진결과",
  tables: [],
  status: "raw" as const,
  automatically_confirmed: false as const,
  measurements: {
    values: { sbp: 148, fasting_glucose: 112 },
    review: [
      {
        field: "uric_acid",
        label: "요산",
        value: 6.2,
        unit: "mg/dL",
        source: ["요소질소", "6.2", "mg/dL", "8~20"],
        reason: "참고치가 요소질소 범위입니다",
      },
    ],
    unused: [],
    unmatched: [],
  },
};

function stubRuntime(save = vi.fn().mockResolvedValue({ ok: true, value: { id: "doc-1" } })) {
  return { documents: { save } } as unknown as LocalDomainRuntime;
}

function renderPane(runtime: LocalDomainRuntime, onRead = vi.fn()) {
  render(
    <DocumentPane
      runtime={runtime}
      householdId="household-1"
      profileId="profile-1"
      profileName="엄마"
      onRead={onRead}
    />,
  );
  return onRead;
}

/** jsdom 에는 실제 이미지 디코더가 없다. 미리보기는 URL 만 걸면 되므로 그걸로 충분하다. */
function pickFile() {
  return new File(["fake-bytes"], "검진표.png", { type: "image/png" });
}

describe("DocumentPane", () => {
  it("읽는 동안 단계와 흘러온 글을 보여 준다 — 멈춘 것과 도는 것을 구분할 수 있어야 한다", async () => {
    // 예전에는 한 줄이었다("표를 읽고 있어요…"). 7~20초 동안 화면에서 움직이는
    // 것이 없어서, 사용자가 그 시간에 파일을 다시 고르는 일이 생겼다.
    let emit: ((progress: { text: string }) => void) | undefined;
    let finish: ((result: unknown) => void) | undefined;
    vi.spyOn(GeminiOcrAdapter.prototype, "recognize").mockImplementation(
      (_file, _name, options) =>
        new Promise((resolve) => {
          emit = options?.onProgress;
          finish = resolve as (result: unknown) => void;
        }),
    );
    const user = userEvent.setup();
    renderPane(stubRuntime());

    await user.upload(screen.getByLabelText(/검진표 이미지나 PDF/), pickFile());

    const panel = await screen.findByRole("region", { name: "검진표 인식 진행" });
    // 워커가 아직 안 집었으면 "서버 대기" 다. 단계 이름을 지어내지 않는다.
    const at = () => panel.querySelector('[aria-current="step"]')?.textContent?.trim();
    await waitFor(() => expect(at()).toBe("서버 대기"));
    expect(within(panel).getByText(/초 경과/)).toBeInTheDocument();

    // 글자가 들어오면 읽기 단계로 넘어가고 **그 글자 자체**를 띄운다 — 자기
    // 검진표의 글자가 보이는 것이 "지금 읽고 있다" 를 가장 확실하게 말한다.
    emit?.({ text: "공복혈당 112 mg/dL\n총콜레스테롤 210 mg/dL" });
    await waitFor(() => expect(within(panel).getByText(/총콜레스테롤 210/)).toBeInTheDocument());
    expect(at()).toBe("표 읽는 중");
    expect(panel.querySelector(".ocr-stream-count")?.textContent).toMatch(/지금까지 \d+자/);

    // `reset` 은 글자 수를 0 으로 되돌린다. 감추면 사용자는 그걸 버그로 읽는다.
    emit?.({ text: "" });
    await waitFor(() => expect(within(panel).getByText(/다른 모델로 다시 시작/)).toBeInTheDocument());

    finish?.(RECOGNIZED);
    // 끝나면 진행 패널은 사라지고 결과가 선다.
    await waitFor(() => expect(screen.queryByRole("region", { name: "검진표 인식 진행" })).not.toBeInTheDocument());
    expect(screen.getByText(/수치 2개를 읽어/)).toBeInTheDocument();
  });

  it("고른 검진표를 암호화 보관함에 먼저 저장한다", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, value: { id: "doc-1" } });
    vi.spyOn(GeminiOcrAdapter.prototype, "recognize").mockResolvedValue(RECOGNIZED as never);
    const user = userEvent.setup();
    renderPane(stubRuntime(save));

    await user.upload(screen.getByLabelText(/검진표 이미지나 PDF/), pickFile());

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({
      householdId: "household-1",
      profileId: "profile-1",
      fileName: "검진표.png",
    });
  });

  it("관문을 통과한 수치만 폼으로 넘긴다", async () => {
    vi.spyOn(GeminiOcrAdapter.prototype, "recognize").mockResolvedValue(RECOGNIZED as never);
    const user = userEvent.setup();
    const onRead = renderPane(stubRuntime());

    await user.upload(screen.getByLabelText(/검진표 이미지나 PDF/), pickFile());

    await waitFor(() => expect(onRead).toHaveBeenCalled());
    const reading = onRead.mock.calls[0][0];
    expect(reading.values).toEqual({ sbp: 148, fasting_glucose: 112 });
    // 걸러 낸 행은 폼으로 가지 않는다.
    expect(reading.values).not.toHaveProperty("uric_acid");
  });

  it("걸러 낸 행을 원문과 함께 남긴다", async () => {
    vi.spyOn(GeminiOcrAdapter.prototype, "recognize").mockResolvedValue(RECOGNIZED as never);
    const user = userEvent.setup();
    renderPane(stubRuntime());

    await user.upload(screen.getByLabelText(/검진표 이미지나 PDF/), pickFile());

    expect(await screen.findByText(/확인이 필요한 1개/)).toBeInTheDocument();
    expect(screen.getByText("참고치가 요소질소 범위입니다")).toBeInTheDocument();
    expect(screen.getByText(/요소질소 · 6.2 · mg\/dL · 8~20/)).toBeInTheDocument();
  });

  it("인식 중에 다른 검진표를 고르면 먼저 것이 나중 것을 덮지 않는다", async () => {
    let settleFirst: ((value: unknown) => void) | undefined;
    const recognize = vi
      .spyOn(GeminiOcrAdapter.prototype, "recognize")
      .mockImplementationOnce(() => new Promise((resolve) => (settleFirst = resolve)) as never)
      .mockResolvedValueOnce({
        ...RECOGNIZED,
        measurements: { ...RECOGNIZED.measurements, values: { hdl: 42 } },
      } as never);
    const user = userEvent.setup();
    const onRead = renderPane(stubRuntime());
    const picker = screen.getByLabelText(/검진표 이미지나 PDF|다른 검진표 고르기/);

    // 첫 장은 아직 인식 중. 그 사이 두 번째를 고른다.
    await user.upload(picker, new File(["a"], "첫장.png", { type: "image/png" }));
    await user.upload(picker, new File(["b"], "둘째장.png", { type: "image/png" }));
    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onRead).toHaveBeenCalledWith(expect.objectContaining({ values: { hdl: 42 } })));

    // 이제 첫 장이 늦게 끝난다. 밀려난 결과라 폼으로 가면 안 된다.
    settleFirst?.(RECOGNIZED);
    await waitFor(() => expect(onRead).toHaveBeenCalledTimes(1));
    expect(onRead).not.toHaveBeenCalledWith(expect.objectContaining({ values: { sbp: 148, fasting_glucose: 112 } }));
  });

  it("인식이 실패하면 이유를 화면에 적는다", async () => {
    vi.spyOn(GeminiOcrAdapter.prototype, "recognize").mockRejectedValue(new Error("쓸 수 있는 공급자가 없습니다"));
    const user = userEvent.setup();
    const onRead = renderPane(stubRuntime());

    await user.upload(screen.getByLabelText(/검진표 이미지나 PDF/), pickFile());

    expect(await screen.findByRole("alert")).toHaveTextContent("쓸 수 있는 공급자가 없습니다");
    expect(onRead).not.toHaveBeenCalled();
  });
});
