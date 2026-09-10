/**
 * 기록 하나를 어떻게 읽는가 — `recordSummary.ts` 의 계약.
 *
 * **왜 이 파일이 생겼나.** 화면마다 payload 를 따로 읽어서 같은 기록이 다르게
 * 보였다(2026-09-10 실측). 가족 홈은 "저장된 건강기록" 이라고만 적고, 건강기록
 * 화면은 "혈압 128/82 mmHg" 라고 적었다. 읽는 방법을 한 곳에 모은 뒤로는 그
 * 한 곳이 틀리면 **모든 화면이 같이 틀린다** — 그래서 여기 계약을 박는다.
 */

import { describe, expect, it } from "vitest";

import type { HealthRecord, HealthRecordType } from "./domainContracts";
import { recordSummary, recordTypeLabel, recordValues } from "./recordSummary";

function record(recordType: HealthRecordType, payload: Record<string, unknown>): HealthRecord {
  return {
    id: "r1",
    householdId: "h1",
    profileId: "p1",
    recordType,
    recordedAt: "2026-09-10T10:00:00+09:00",
    source: "manual",
    payload,
    version: 1,
    createdAt: "2026-09-10T10:00:00+09:00",
    updatedAt: "2026-09-10T10:00:00+09:00",
    deletedAt: null,
  } as unknown as HealthRecord;
}

describe("recordValues", () => {
  it("옛 이름과 지금 이름을 모두 읽는다", () => {
    // writer 를 통일하기 전(2026-09-10) 저장된 기록도 값이 보여야 한다.
    const legacy = recordValues(record("blood_pressure", { systolic: 142, diastolic: 91 }));
    const current = recordValues(record("blood_pressure", { systolicMmHg: 142, diastolicMmHg: 91 }));

    expect(legacy.map((v) => v.value)).toEqual([142, 91]);
    expect(current.map((v) => v.value)).toEqual([142, 91]);
    expect(current.map((v) => v.field)).toEqual(["sbp", "dbp"]);
  });

  it("챌린지 측정은 키가 이미 판정 칸 이름이라 그대로 쓴다", () => {
    const got = recordValues(record("blood_pressure", { values: { sbp: 131, dbp: 85 } }));

    expect(got.map((v) => [v.field, v.value])).toEqual([
      ["sbp", 131],
      ["dbp", 85],
    ]);
  });

  it("식후 혈당은 판정 칸에 잇지 않는다", () => {
    // 식후 값을 `fasting_glucose` 로 쓰면 정상인도 당뇨로 판정된다.
    // 서버 `record_prefill` 과 **같은 규칙**이어야 두 경로가 갈리지 않는다.
    const after = recordValues(record("blood_glucose", { valueMgDl: 188, timing: "after_meal" }));
    const fasting = recordValues(record("blood_glucose", { valueMgDl: 104, timing: "fasting" }));

    expect(after[0].field).toBeUndefined();
    expect(after[0].label).toBe("식후 혈당");
    expect(fasting[0].field).toBe("fasting_glucose");
  });

  it("운동 기록의 무게는 체중이 아니다", () => {
    // `weightKg` 이 운동에서는 **든 무게**다. 종류를 안 보면 역기가 체중 추이에 들어간다.
    const exercise = recordValues(record("exercise", { exerciseName: "스쿼트", weightKg: 60, reps: 10 }));
    const body = recordValues(record("body_measurement", { weightKg: 78.4 }));

    expect(exercise.some((v) => v.field === "weight_kg")).toBe(false);
    expect(body.find((v) => v.field === "weight_kg")?.value).toBe(78.4);
  });

  it("검진표가 여러 줄로 담은 값도 펼친다", () => {
    const got = recordValues(
      record("health_screening", {
        items: [
          { testName: "공복혈당", value: 104, unit: "mg/dL" },
          { testName: "당화혈색소", value: 6.1, unit: "%" },
        ],
      }),
    );

    expect(got.map((v) => v.label)).toEqual(["공복혈당", "당화혈색소"]);
  });

  it("수치가 없는 종류는 빈 목록이다", () => {
    expect(recordValues(record("medication", { medicationName: "메트포르민" }))).toEqual([]);
  });
});

describe("recordSummary", () => {
  it("수치가 있으면 메모가 아니라 수치로 말한다", () => {
    // **옛 요약기는 `note` 를 먼저 돌려줬다.** 그래서 메모를 적은 혈압 기록과
    // 안 적은 것이 목록에서 다르게 읽혔다 — 같은 값인데.
    const withNote = record("blood_pressure", {
      systolicMmHg: 128,
      diastolicMmHg: 82,
      note: "약 먹고 30분 뒤 측정",
    });

    expect(recordSummary(withNote)).toBe("혈압 128/82 mmHg");
  });

  it("혈압은 128/82 로 붙여 읽는다", () => {
    expect(recordSummary(record("blood_pressure", { systolicMmHg: 128, diastolicMmHg: 82, pulseBpm: 72 }))).toBe(
      "혈압 128/82 mmHg · 맥박 72bpm",
    );
  });

  it("수치가 없으면 이름과 메모를 쓴다", () => {
    expect(recordSummary(record("medication", { medicationName: "메트포르민", dosage: "500mg" }))).toBe("메트포르민");
    expect(recordSummary(record("note", { text: "어제부터 어지럽다" }))).toBe("어제부터 어지럽다");
  });

  it("아무것도 없으면 종류 이름으로 떨어진다 — 빈 문자열을 내지 않는다", () => {
    // 목록에서 한 줄이 통째로 비면 그 행이 고장으로 보인다.
    expect(recordSummary(record("pain", {}))).toBe("통증");
    expect(recordTypeLabel("daily_condition")).toBe("컨디션");
  });
});

describe("정본 맵과 읽은 행", () => {
  it("정본 맵이 있으면 읽은 행을 값으로 두 번 세지 않는다", () => {
    // **같은 수치가 두 번 서던 자리다.** 검진표는 OCR 행(`items`)과 판정 칸
    // 이름으로 정리한 맵(`values`)을 같이 담는데, 둘을 다 세면 목록에 공복혈당이
    // 두 줄로 서고 추이 그래프에는 같은 날 같은 점이 두 개 찍힌다.
    const got = recordValues(
      record("health_screening", {
        items: [
          { testName: "공복혈당", value: 104, unit: "mg/dL" },
          { testName: "당화혈색소", value: 6.1, unit: "%" },
        ],
        values: { fasting_glucose: 96, hba1c: 6.1 },
      }),
    );

    expect(got.filter((v) => v.field === "fasting_glucose")).toHaveLength(1);
    // 고친 값이 이긴다 — 서버 `record_prefill.fields_for` 와 같은 순서다.
    expect(got.find((v) => v.field === "fasting_glucose")?.value).toBe(96);
    expect(got).toHaveLength(2);
  });

  it("정본 맵이 없는 옛 기록은 그대로 읽은 행을 쓴다", () => {
    const got = recordValues(
      record("health_screening", { items: [{ testName: "공복혈당", value: 104, unit: "mg/dL" }] }),
    );

    expect(got.map((v) => [v.label, v.value])).toEqual([["공복혈당", 104]]);
  });
});
