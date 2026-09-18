import { describe, expect, it } from "vitest";
import {
  extractObservationsFromRecord,
  extractObservationsFromSnapshot,
  mergeObservations,
  observationsToFamilyData,
  type ObservationPoint,
} from "./timeSeriesObservation";
import type { HealthRecord, AssessmentSnapshotPayload, FamilyProfile } from "../../shared/local/domainContracts";

describe("timeSeriesObservation", () => {
  it("일반 건강기록(혈압계)에서 sbp, dbp 관측점을 올바르게 추출한다", () => {
    const record: HealthRecord = {
      id: "rec_bp_1",
      householdId: "hh_1",
      profileId: "prof_1",
      recordType: "blood_pressure",
      recordedAt: "2026-09-10T09:00:00Z",
      payload: {
        systolicMmHg: 128,
        diastolicMmHg: 82,
        pulseBpm: 72,
        measuredAt: "2026-09-10T08:30:00Z",
      },
      source: "manual",
      sourceDocumentId: null,
      deletedAt: null,
      createdAt: "2026-09-10T09:00:00Z",
      updatedAt: "2026-09-10T09:00:00Z",
      version: 1,
    };

    const points = extractObservationsFromRecord(record);
    expect(points.length).toBe(2);

    const sbp = points.find((p) => p.metricKey === "sbp");
    expect(sbp).toBeDefined();
    expect(sbp?.value).toBe(128);
    expect(sbp?.unit).toBe("mmHg");
    expect(sbp?.measuredAt).toBe("2026-09-10T08:30:00Z");
    expect(sbp?.sourceType).toBe("direct_vital");

    const dbp = points.find((p) => p.metricKey === "dbp");
    expect(dbp).toBeDefined();
    expect(dbp?.value).toBe(82);
  });

  it("판정 스냅샷에서 inputs의 지표들을 올바르게 추출한다", () => {
    const snapshot: HealthRecord<AssessmentSnapshotPayload> = {
      id: "snap_1",
      householdId: "hh_1",
      profileId: "prof_1",
      recordType: "assessment",
      recordedAt: "2026-09-11T10:00:00Z",
      payload: {
        inputs: {
          sbp: 130,
          dbp: 84,
          weight_kg: 75.5,
          fasting_glucose: 98,
        },
        levels: {},
        engines: {},
        bmi: 24.5,
        evaluated: 1,
        total: 1,
        highestLevel: "NORMAL",
      },
      source: "manual",
      sourceDocumentId: null,
      deletedAt: null,
      createdAt: "2026-09-11T10:00:00Z",
      updatedAt: "2026-09-11T10:00:00Z",
      version: 1,
    };

    const points = extractObservationsFromSnapshot(snapshot);
    expect(points.length).toBe(4);

    const weight = points.find((p) => p.metricKey === "weight_kg");
    expect(weight?.value).toBe(75.5);
    expect(weight?.unit).toBe("kg");
    expect(weight?.sourceType).toBe("assessment_snapshot");
  });

  it("명시적으로 원천 기록을 가리키는 판정 스냅샷만 중복 제거한다", () => {
    const rawDirect: ObservationPoint = {
      id: "rec_1:sbp",
      profileId: "prof_1",
      metricKey: "sbp",
      label: "수축기",
      value: 128,
      unit: "mmHg",
      measuredAt: "2026-09-12T09:00:00Z",
      recordedAt: "2026-09-12T09:00:00Z",
      sourceType: "direct_vital",
      sourceRecordId: "rec_1",
    };

    const rawSnapshot: ObservationPoint = {
      id: "snap_1:sbp",
      profileId: "prof_1",
      metricKey: "sbp",
      label: "수축기",
      value: 130,
      unit: "mmHg",
      measuredAt: "2026-09-12T11:00:00Z",
      recordedAt: "2026-09-12T11:00:00Z",
      sourceType: "assessment_snapshot",
      sourceRecordId: "snap_1",
      linkedSourceRecordId: "rec_1",
    };

    const merged = mergeObservations([rawSnapshot, rawDirect]);
    expect(merged.length).toBe(1);
    expect(merged[0].sourceType).toBe("direct_vital");
    expect(merged[0].value).toBe(128);
  });

  it("같은 날의 서로 다른 실측은 임의로 합치지 않는다", () => {
    const base: ObservationPoint = {
      id: "rec_1:sbp",
      profileId: "prof_1",
      metricKey: "sbp",
      label: "수축기",
      value: 128,
      unit: "mmHg",
      measuredAt: "2026-09-12T09:00:00Z",
      recordedAt: "2026-09-12T09:00:00Z",
      sourceType: "direct_vital",
      sourceRecordId: "rec_1",
    };
    const remeasurement = { ...base, id: "rec_2:sbp", sourceRecordId: "rec_2", value: 132 };
    expect(mergeObservations([base, remeasurement])).toHaveLength(2);
  });

  it("관측점 목록을 가족 비교 데이터 구조로 올바르게 맵핑한다", () => {
    const profiles: FamilyProfile[] = [
      {
        id: "p1",
        householdId: "hh_1",
        displayName: "오성민",
        relationship: "본인",
        birthDate: "1988-01-01",
        gender: "male",
        accountEmail: null,
        opaqueServerRef: null,
        serverRefState: "none",
        status: "active",
        mergedIntoProfileId: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        version: 1,
      },
    ];

    const observations: ObservationPoint[] = [
      {
        id: "1",
        profileId: "p1",
        metricKey: "sbp",
        label: "수축기",
        value: 120,
        unit: "mmHg",
        measuredAt: "2026-09-01T00:00:00Z",
        recordedAt: "2026-09-01T00:00:00Z",
        sourceType: "direct_vital",
        sourceRecordId: "r1",
      },
      {
        id: "2",
        profileId: "p1",
        metricKey: "sbp",
        label: "수축기",
        value: 124,
        unit: "mmHg",
        measuredAt: "2026-09-05T00:00:00Z",
        recordedAt: "2026-09-05T00:00:00Z",
        sourceType: "direct_vital",
        sourceRecordId: "r2",
      },
    ];

    const familyData = observationsToFamilyData(observations, profiles);
    expect(familyData["p1"]).toBeDefined();
    expect(familyData["p1"].name).toBe("오성민");
    expect(familyData["p1"].metrics["sbp"].length).toBe(2);
    expect(familyData["p1"].metrics["sbp"][1].value).toBe(124);
  });
});
