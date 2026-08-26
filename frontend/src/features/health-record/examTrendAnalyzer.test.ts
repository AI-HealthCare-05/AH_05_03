import { describe, expect, it } from "vitest";
import type { HealthRecord } from "../../shared/local/domainContracts";
import { analyzeExamTrends } from "./examTrendAnalyzer";

describe("analyzeExamTrends", () => {
  it("동일 의미의 FBS와 공복혈당이 '공복혈당' 시계열로 통합되어 변화가 계산된다", () => {
    const records: HealthRecord[] = [
      {
        id: "rec-1",
        householdId: "h1",
        profileId: "p1",
        recordType: "lab_result",
        recordedAt: "2023-05-10T12:00:00.000Z",
        source: "ocr",
        sourceDocumentId: "doc-1",
        payload: { note: "[검사 결과 요약]\nFBS | 110 | mg/dL | 정상" },
        deletedAt: null,
        createdAt: "2023-05-10T12:05:00.000Z",
        updatedAt: "2023-05-10T12:05:00.000Z",
        version: 1,
      },
      {
        id: "rec-2",
        householdId: "h1",
        profileId: "p1",
        recordType: "lab_result",
        recordedAt: "2024-05-12T12:00:00.000Z",
        source: "ocr",
        sourceDocumentId: "doc-2",
        payload: { note: "[검사 결과 요약]\n공복 혈당 | 105 | mg/dL | 정상" },
        deletedAt: null,
        createdAt: "2024-05-12T12:05:00.000Z",
        updatedAt: "2024-05-12T12:05:00.000Z",
        version: 1,
      },
    ];

    const result = analyzeExamTrends(records);
    expect(result.metrics.length).toBe(1);

    const fbgSeries = result.metrics[0];
    expect(fbgSeries.canonicalName).toBe("공복혈당");
    expect(fbgSeries.dataPoints.length).toBe(2);
    expect(fbgSeries.dataPoints[0].value).toBe("110");
    expect(fbgSeries.dataPoints[1].value).toBe("105");
    expect(fbgSeries.latest.diffFromPrev?.numericDiff).toBe(-5);
    expect(fbgSeries.latest.diffFromPrev?.direction).toBe("decreased");

    // Provenance 검증
    expect(fbgSeries.dataPoints[0].recordId).toBe("rec-1");
    expect(fbgSeries.dataPoints[0].sourceDocumentId).toBe("doc-1");
    expect(fbgSeries.dataPoints[0].source).toBe("ocr");
    expect(fbgSeries.dataPoints[0].isUserConfirmed).toBe(true);
    expect(fbgSeries.dataPoints[0].rawName).toBe("FBS");
  });

  it("동일 날짜에 여러 기록이 존재할 때 더 최근에 생성(createdAt)된 기록을 우선 반영한다", () => {
    const records: HealthRecord[] = [
      {
        id: "rec-old",
        householdId: "h1",
        profileId: "p1",
        recordType: "blood_glucose",
        recordedAt: "2026-08-25T12:00:00.000Z",
        source: "manual",
        sourceDocumentId: null,
        payload: { value: 117, timing: "fasting" },
        deletedAt: null,
        createdAt: "2026-08-25T12:05:00.000Z",
        updatedAt: "2026-08-25T12:05:00.000Z",
        version: 1,
      },
      {
        id: "rec-new",
        householdId: "h1",
        profileId: "p1",
        recordType: "blood_glucose",
        recordedAt: "2026-08-25T08:00:00.000Z",
        source: "manual",
        sourceDocumentId: null,
        payload: { value: 120, timing: "fasting" },
        deletedAt: null,
        createdAt: "2026-08-26T13:00:00.000Z",
        updatedAt: "2026-08-26T13:00:00.000Z",
        version: 1,
      },
    ];

    const result = analyzeExamTrends(records);
    const fbg = result.metrics.find((m) => m.canonicalName === "공복혈당");
    expect(fbg).toBeDefined();
    expect(fbg?.dataPoints.length).toBe(1);
    expect(fbg?.dataPoints[0].value).toBe("120");
    expect(fbg?.dataPoints[0].recordId).toBe("rec-new");
  });

  it("식후혈당과 공복혈당은 절대 같은 시계열에 섞이지 않고 분리된다", () => {
    const records: HealthRecord[] = [
      {
        id: "rec-1",
        householdId: "h1",
        profileId: "p1",
        recordType: "blood_glucose",
        recordedAt: "2024-01-01T08:00:00.000Z",
        source: "manual",
        sourceDocumentId: null,
        payload: { value: 95, timing: "fasting" },
        deletedAt: null,
        createdAt: "2024-01-01T08:05:00.000Z",
        updatedAt: "2024-01-01T08:05:00.000Z",
        version: 1,
      },
      {
        id: "rec-2",
        householdId: "h1",
        profileId: "p1",
        recordType: "blood_glucose",
        recordedAt: "2024-01-01T13:00:00.000Z",
        source: "manual",
        sourceDocumentId: null,
        payload: { value: 140, timing: "after_meal" },
        deletedAt: null,
        createdAt: "2024-01-01T13:05:00.000Z",
        updatedAt: "2024-01-01T13:05:00.000Z",
        version: 1,
      },
    ];

    const result = analyzeExamTrends(records);
    expect(result.metrics.length).toBe(2);

    const names = result.metrics.map((m) => m.canonicalName);
    expect(names).toContain("공복혈당");
    expect(names).toContain("식후혈당");
  });

  it("HbA1c(당화혈색소)는 % 단위를 가지며 일반 혈당과 별도 시계열로 관리된다", () => {
    const records: HealthRecord[] = [
      {
        id: "rec-1",
        householdId: "h1",
        profileId: "p1",
        recordType: "lab_result",
        recordedAt: "2024-05-10T12:00:00.000Z",
        source: "ocr",
        sourceDocumentId: "doc-1",
        payload: { note: "[검사 결과 요약]\nHbA1c | 5.8 | % | 정상\n공복혈당 | 102 | mg/dL | 정상" },
        deletedAt: null,
        createdAt: "2024-05-10T12:05:00.000Z",
        updatedAt: "2024-05-10T12:05:00.000Z",
        version: 1,
      },
    ];

    const result = analyzeExamTrends(records);
    expect(result.metrics.length).toBe(2);

    const hba1c = result.metrics.find((m) => m.canonicalName === "당화혈색소 (HbA1c)");
    const fbg = result.metrics.find((m) => m.canonicalName === "공복혈당");

    expect(hba1c).toBeDefined();
    expect(fbg).toBeDefined();
    expect(hba1c?.unit).toBe("%");
    expect(fbg?.unit).toBe("mg/dL");
  });

  it("수축기 혈압과 이완기 혈압이 별도 시계열로 추출된다", () => {
    const records: HealthRecord[] = [
      {
        id: "rec-1",
        householdId: "h1",
        profileId: "p1",
        recordType: "blood_pressure",
        recordedAt: "2024-05-10T12:00:00.000Z",
        source: "manual",
        sourceDocumentId: null,
        payload: { systolic: 125, diastolic: 82 },
        deletedAt: null,
        createdAt: "2024-05-10T12:05:00.000Z",
        updatedAt: "2024-05-10T12:05:00.000Z",
        version: 1,
      },
    ];

    const result = analyzeExamTrends(records);
    const sbp = result.metrics.find((m) => m.canonicalName === "수축기 혈압");
    const dbp = result.metrics.find((m) => m.canonicalName === "이완기 혈압");

    expect(sbp?.latest.numericValue).toBe(125);
    expect(dbp?.latest.numericValue).toBe(82);
  });

  it("삭제된 기록(deletedAt이 존재하는 기록)은 트렌드 분석 대상에서 완전히 제외된다", () => {
    const records: HealthRecord[] = [
      {
        id: "rec-1",
        householdId: "h1",
        profileId: "p1",
        recordType: "blood_glucose",
        recordedAt: "2024-01-01T08:00:00.000Z",
        source: "manual",
        sourceDocumentId: null,
        payload: { value: 95, timing: "fasting" },
        deletedAt: "2024-01-02T00:00:00.000Z",
        createdAt: "2024-01-01T08:05:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        version: 2,
      },
    ];

    const result = analyzeExamTrends(records);
    expect(result.metrics.length).toBe(0);
    expect(result.dates.length).toBe(0);
  });
});
