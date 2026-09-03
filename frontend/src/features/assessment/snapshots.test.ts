import { describe, expect, it } from "vitest";

import type { AssessmentSnapshotPayload, HealthRecord } from "../../shared/local/domainContracts";
import { buildLevelTracks, buildSeries, TREND_SERIES, type Snapshot } from "./snapshots";

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
