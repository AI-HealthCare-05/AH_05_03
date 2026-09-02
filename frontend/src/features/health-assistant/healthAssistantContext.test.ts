import { describe, expect, it } from "vitest";

import { selectContextRecordTypes } from "./healthAssistantContext";

describe("selectContextRecordTypes", () => {
  it("일반 대화와 기록 입력에는 과거 기록을 선택하지 않는다", () => {
    expect(selectContextRecordTypes("안녕")).toEqual([]);
    expect(selectContextRecordTypes("랫풀다운 20kg 10개 3세트")).toEqual([]);
  });

  it("음주 안전 질문에는 복약 기록만 선택한다", () => {
    expect(selectContextRecordTypes("타이레놀 먹었는데 오늘 술 마셔도 돼?")).toEqual(["medication"]);
  });

  it("운동 가능 여부 질문에는 운동과 걷기 기록을 선택한다", () => {
    expect(selectContextRecordTypes("오늘 운동해도 괜찮아?")).toEqual(["exercise", "walking"]);
  });

  it("후속 답변도 앞선 건강 질문과 함께 전달되면 필요한 기록을 유지한다", () => {
    expect(selectContextRecordTypes("약 먹고 담배 피워도 돼?\n어떤 약을 드셨나요?\n이지엔 한 알 먹었어")).toEqual([
      "medication",
    ]);
  });
});
