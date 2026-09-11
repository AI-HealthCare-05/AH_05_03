/**
 * 검진 기록을 열면 **수치가 보이고, 빈 칸이 보이고, 예측으로 갈 수 있다.**
 *
 * **왜 이 파일이 생겼나.** 챗봇으로 검진표를 올려 저장한 기록을 자세히로 열면
 * "그날 넣은 값 0개 · 남아 있는 등급이 없습니다" 가 떴다. `RecordDetail` 이 판정
 * 스냅샷 전용 화면이라 `payload.inputs` 만 읽는데, 검진 기록에는 그 칸이 없다.
 * 21개 항목이 담긴 기록에서 사용자가 본 것은 빈 화면이었다(2026-09-10).
 *
 * 그리고 빈 칸을 세우는 것이 이 화면의 요점이다 — 읽힌 것만 보여 주면 **무엇이
 * 모자라서 판정이 안 되는지**를 화면이 끝내 말하지 않는다.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalDomainProvider } from "../../app/LocalDomainProvider";
import { RecordValueDetail, showsEveryField } from "./ValueSheet";
import type { HealthRecord } from "../../shared/local/domainContracts";

afterEach(cleanup);

function screening(payload: Record<string, unknown>, extra: Partial<HealthRecord> = {}): HealthRecord {
  return {
    id: "rec-1",
    householdId: "h1",
    profileId: "p1",
    recordType: "health_screening",
    recordedAt: "2026-08-28T09:00:00+09:00",
    source: "ocr",
    sourceDocumentId: "doc-1",
    payload,
    version: 1,
    createdAt: "2026-08-28T09:00:00+09:00",
    updatedAt: "2026-08-28T09:00:00+09:00",
    deletedAt: null,
    ...extra,
  } as unknown as HealthRecord;
}

function show(record: HealthRecord, props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <LocalDomainProvider databaseName={`ieobom-sheet-${crypto.randomUUID()}`}>
        <RecordValueDetail record={record} onClose={vi.fn()} {...props} />
      </LocalDomainProvider>
    </MemoryRouter>,
  );
}

describe("showsEveryField", () => {
  it("검진표·검사 결과·서류에서 온 기록은 칸을 다 세운다", () => {
    expect(showsEveryField(screening({}))).toBe(true);
    expect(showsEveryField(screening({}, { recordType: "lab_result", source: "manual", sourceDocumentId: null }))).toBe(true);
  });

  it("손으로 남긴 혈압 한 줄에는 서른여섯 칸을 세우지 않는다", () => {
    const bp = screening({ systolicMmHg: 128 }, {
      recordType: "blood_pressure",
      source: "manual",
      sourceDocumentId: null,
    });
    expect(showsEveryField(bp)).toBe(false);
  });
});

describe("RecordValueDetail", () => {
  it("읽은 값은 채워서, 읽히지 않은 칸은 빈 자리로 보여 준다", async () => {
    show(screening({ values: { sbp: 145, dbp: 88, fasting_glucose: 116 } }));

    // **이 단정이 이 파일의 핵심이다.** 예전에는 값이 하나도 안 떴다.
    expect(await screen.findByText("145")).toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.getByText("116")).toBeInTheDocument();

    // 읽히지 않은 칸도 자리를 지킨다 — 무엇을 채우면 판정되는지가 정보다.
    expect(screen.getByText("당화혈색소")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("수치가 있으면 예측으로 가는 문이 있다", async () => {
    show(screening({ values: { sbp: 145, dbp: 88 } }));
    expect(await screen.findByRole("button", { name: "예측하기" })).toBeInTheDocument();
  });

  it("이 검진표에서 나온 판정이 있으면 다시 판정하지 않고 그 결과로 보낸다", async () => {
    const linked = screening({ inputs: { sbp: 145 } }, { id: "rec-2", recordType: "assessment" });
    const onViewPrediction = vi.fn();
    show(screening({ values: { sbp: 145 } }), { linkedAssessment: linked, onViewPrediction });

    expect(await screen.findByRole("button", { name: "예측 결과 보기" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "예측하기" })).not.toBeInTheDocument();
  });

  it("수정을 누르면 같은 칸이 입력칸으로 바뀐다", async () => {
    show(screening({ values: { sbp: 145 } }));
    const edit = await screen.findByRole("button", { name: "수정" });
    edit.click();

    // 이 화면은 모달 안에서 그려지고, 모달은 `document.body` 로 나간다(포털).
    // render container 안에서 찾으면 못 찾는다 — 2026-09-11 에 옮겼다
    // (`shared/ui/Modal.tsx` 머리말: 조상의 `transform` 이 fixed 백드롭을 가둔다).
    await vi.waitFor(() => {
      expect(document.body.querySelectorAll(".value-sheet-field input").length).toBeGreaterThan(0);
    });
  });

  it("수치가 없는 메모 기록은 빈 화면이 아니라 메모를 세운다", async () => {
    const memo = screening({ text: "어제부터 어지럽다" }, {
      recordType: "note",
      source: "manual",
      sourceDocumentId: null,
    });
    show(memo, { onEdit: vi.fn() });

    expect(await screen.findByText("어제부터 어지럽다")).toBeInTheDocument();
    // 수치가 없으면 예측 문은 세우지 않는다 — 누를 수 없는 버튼을 두지 않는다.
    expect(screen.queryByRole("button", { name: "예측하기" })).not.toBeInTheDocument();
  });

  it("검진 기록의 자세히와 검진 수치 수정이 같은 칸 이름을 쓴다", async () => {
    // 두 화면이 갈라져 있던 자리다. 이제 한 컴포넌트를 쓰므로 라벨이 같다.
    show(screening({ values: { sbp: 145 } }));
    await screen.findByText("145");
    // 라벨은 이름과 단위가 한 span 안에 있다("수축기 mmHg"). 이름으로 찾는다.
    // 모달이 포털로 나가므로 render container 가 아니라 `document.body` 에서 본다.
    const labels = [...document.body.querySelectorAll(".value-sheet-label")].map((el) => el.textContent ?? "");
    expect(labels.some((text) => text.startsWith("수축기"))).toBe(true);
  });

  it("나이·성별은 이 검진이 잰 것이 아니라 세우지 않는다", async () => {
    // **빈 칸으로 세우면 사용자가 채워야 할 것으로 읽힌다.** 나이는 생년월일에서,
    // 성별은 프로필에서 온다. 그리고 이 값이 기록에 실리면 나중에 "이 수치
    // 사용하기" 가 **몇 년 전 나이로 오늘 판정을 덮는다.**
    show(screening({ values: { sbp: 145 } }));
    await screen.findByText("145");

    expect(screen.queryByText("나이")).not.toBeInTheDocument();
    expect(screen.queryByText("성별")).not.toBeInTheDocument();
    // 자기 보고 항목은 남는다 — 이건 사용자만 채울 수 있고 판정이 쓴다.
    expect(screen.getByText(/전반적 건강/)).toBeInTheDocument();
  });
});
