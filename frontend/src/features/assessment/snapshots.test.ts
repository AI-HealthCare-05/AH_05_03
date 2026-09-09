import { describe, expect, it } from "vitest";

import type { AssessmentSnapshotPayload, HealthRecord } from "../../shared/local/domainContracts";
import { buildLevelTracks, buildSeries, saveSnapshot, TREND_SERIES, type Snapshot } from "./snapshots";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
import type { AssessmentSummaryData } from "./contracts";

function snapshot(at: string, payload: Partial<AssessmentSnapshotPayload>): Snapshot {
  return {
    id: at,
    householdId: "h",
    profileId: "p",
    recordType: "assessment",
    recordedAt: at,
    source: "manual",
    sourceDocumentId: null,
    deletedAt: null,
    createdAt: at,
    updatedAt: at,
    version: 1,
    payload: {
      inputs: {},
      levels: {},
      engines: {},
      bmi: 26,
      evaluated: 0,
      total: 13,
      highestLevel: "NORMAL",
      ...payload,
    },
  } as HealthRecord<AssessmentSnapshotPayload>;
}

describe("buildSeries", () => {
  it("두 시점 이상에서 관측된 수치만 계열이 된다", () => {
    const series = buildSeries([
      snapshot("2026-01-01T00:00:00Z", { inputs: { sbp: 148, hba1c: 6.1 } }),
      // 두 번째 시점에는 혈압만 다시 넣었다. 한 점짜리 hba1c 는 선이 안 되므로 뺀다.
      snapshot("2026-04-01T00:00:00Z", { inputs: { sbp: 132 } }),
    ]);

    expect(series.map((s) => s.key)).toEqual(["sbp"]);
    expect(series[0].points.map((p) => p.value)).toEqual([148, 132]);
    expect(series[0].unit).toBe("mmHg");
  });

  it("수치가 아닌 값은 계열에 넣지 않는다", () => {
    // `sex` 는 문자열, `has_diabetes` 는 불리언이다. 좌표로 쓸 수 없다.
    const series = buildSeries([
      snapshot("2026-01-01T00:00:00Z", { inputs: { sex: "M", has_diabetes: false } }),
      snapshot("2026-04-01T00:00:00Z", { inputs: { sex: "M", has_diabetes: true } }),
    ]);
    expect(series).toEqual([]);
  });

  it("계열 순서는 선언 순서를 따른다", () => {
    const inputs = { sbp: 1, dbp: 1, weight_kg: 1 };
    const series = buildSeries([
      snapshot("2026-01-01T00:00:00Z", { inputs }),
      snapshot("2026-04-01T00:00:00Z", { inputs }),
    ]);
    const declared = TREND_SERIES.map((s) => s.key).filter((k) => k in inputs);
    expect(series.map((s) => s.key)).toEqual(declared);
  });
});

describe("buildLevelTracks", () => {
  it("등급이 바뀐 질환만 낸다", () => {
    const tracks = buildLevelTracks([
      snapshot("2026-01-01T00:00:00Z", { levels: { htn: "CAUTION", dm: "NORMAL" }, engines: { htn: "E2", dm: "E2" } }),
      snapshot("2026-04-01T00:00:00Z", { levels: { htn: "HIGH", dm: "NORMAL" }, engines: { htn: "E1", dm: "E2" } }),
    ]);

    // 안 바뀐 줄을 스무 개 그리면 못 읽는다.
    expect(tracks.map((t) => t.key)).toEqual(["htn"]);
    expect(tracks[0].levels).toEqual(["CAUTION", "HIGH"]);
  });

  it("정본 엔진이 바뀐 지점을 표시한다", () => {
    const tracks = buildLevelTracks([
      snapshot("2026-01-01T00:00:00Z", { levels: { htn: "CAUTION" }, engines: { htn: "E2" } }),
      snapshot("2026-04-01T00:00:00Z", { levels: { htn: "CAUTION" }, engines: { htn: "E1" } }),
    ]);

    // 등급은 그대로인데 엔진이 바뀌었다 — 검사값이 들어온 시점이고, 그 사실 자체가
    // 사용자가 알아야 하는 정보다. 그래서 등급이 안 바뀌어도 궤적을 낸다.
    expect(tracks).toHaveLength(1);
    expect(tracks[0].engineChanges).toEqual([1]);
  });

  it("한 시점만 있으면 변화가 없다", () => {
    const tracks = buildLevelTracks([
      snapshot("2026-01-01T00:00:00Z", { levels: { htn: "HIGH" }, engines: { htn: "E1" } }),
    ]);
    expect(tracks).toEqual([]);
  });

  it("빈 payload 에도 깨지지 않는다", () => {
    // 옛 스냅샷이나 손상된 레코드가 섞여도 대시보드가 통째로 죽으면 안 된다.
    const broken = snapshot("2026-01-01T00:00:00Z", {});
    broken.payload = {} as AssessmentSnapshotPayload;
    expect(() => buildLevelTracks([broken, broken])).not.toThrow();
    expect(() => buildSeries([broken, broken])).not.toThrow();
  });
});


/**
 * 같은 값으로 다시 판정해도 새 점이 생기지 않는다.
 *
 * 판정하기를 누를 때마다 자동으로 한 점이 쌓이는 구조라, "지난 판정으로 채우기" 로
 * 값을 되불러와 다시 판정하면 한 글자도 안 바뀐 점이 계속 늘어난다. 실측으로 같은
 * 날 8,603 바이트짜리 행이 두 번 나란히 저장돼 있었다.
 */
describe("saveSnapshot 중복 방지", () => {
  const RESULT = {
    bmi: 26,
    summary: { evaluated: 2, total: 14, highest_level: "HIGH" },
    verdicts: [{ key: "htn", risk_level: "HIGH", engine: "E1" }],
    disease_risks: {},
  } as unknown as AssessmentSummaryData;

  function runtimeWith(existing: Snapshot[], created: { calls: number; updates: number }) {
    return {
      healthRecords: {
        query: async () => ({ ok: true, value: existing }),
        create: async (input: Record<string, unknown>) => {
          created.calls += 1;
          return {
            ok: true,
            value: { ...snapshot("2026-05-01T00:00:00Z", {}), payload: input.payload },
          };
        },
        // 같은 입력이면 새로 만들지 않고 기존 기록에 회차를 얹는다.
        update: async (_id: string, input: Record<string, unknown>) => {
          created.updates += 1;
          return {
            ok: true,
            value: { ...existing.at(-1), payload: input.payload },
          };
        },
      },
    } as unknown as LocalDomainRuntime;
  }

  it("앞 기록과 값·등급이 같으면 새로 만들지 않는다", async () => {
    const previous = snapshot("2026-04-01T00:00:00Z", {
      inputs: { age: 52, sbp: 148 },
      levels: { htn: "HIGH" },
    });
    const created = { calls: 0, updates: 0 };
    const outcome = await saveSnapshot(
      runtimeWith([previous], created),
      "p",
      { age: "52", sbp: "148" },
      RESULT,
    );

    expect(outcome.kind).toBe("rechecked");
    expect(created.calls).toBe(0);
    // 시각은 안 고친다 — 그날 본 화면을 남기는 것이 스냅샷의 존재 이유다.
    expect(outcome.snapshot.recordedAt).toBe("2026-04-01T00:00:00Z");
  });

  it("수치가 하나라도 바뀌면 새 점이 된다", async () => {
    const previous = snapshot("2026-04-01T00:00:00Z", {
      inputs: { age: 52, sbp: 148 },
      levels: { htn: "HIGH" },
    });
    const created = { calls: 0, updates: 0 };
    const outcome = await saveSnapshot(
      runtimeWith([previous], created),
      "p",
      { age: "52", sbp: "132" },
      RESULT,
    );

    expect(outcome.kind).not.toBe("rechecked");
    expect(created.calls).toBe(1);
  });

  it("값이 같은데 등급이 바뀌면 새 점이 아니라 2차로 쌓인다", async () => {
    const previous = snapshot("2026-04-01T00:00:00Z", {
      inputs: { age: 52, sbp: 148 },
      levels: { htn: "CAUTION" },
    });
    const created = { calls: 0, updates: 0 };
    const outcome = await saveSnapshot(
      runtimeWith([previous], created),
      "p",
      { age: "52", sbp: "148" },
      RESULT,
    );

    // 같은 입력이므로 기록은 하나다. 등급이 달라진 것을 회차로 남긴다 —
    // 모델이나 임계값이 갱신됐다는 뜻이고, 그건 이 제품에서 남길 값어치가 있다.
    expect(outcome.kind).toBe("changed");
    expect(outcome.run).toBe(2);
    expect(created.calls).toBe(0);
  });

  it("첫 기록은 언제나 만든다", async () => {
    const created = { calls: 0, updates: 0 };
    const outcome = await saveSnapshot(runtimeWith([], created), "p", { age: "52" }, RESULT);
    expect(outcome.kind).not.toBe("rechecked");
    expect(created.calls).toBe(1);
  });
});
