import { describe, expect, it } from "vitest";
import { queryLocalHealthRAG } from "./healthAssistantRAG";
import type { HealthRecord } from "../../shared/local/domainContracts";

const mockRecords: HealthRecord[] = [
  {
    id: "rec-1",
    householdId: "house-1",
    profileId: "prof-1",
    recordType: "blood_glucose",
    recordedAt: "2026-08-20T08:00:00Z",
    source: "manual",
    sourceDocumentId: null,
    deletedAt: null,
    createdAt: "2026-08-20T08:00:00Z",
    updatedAt: "2026-08-20T08:00:00Z",
    version: 1,
    payload: {
      value: 105,
      timing: "fasting",
      note: "아침 공복",
    },
  },
  {
    id: "rec-2",
    householdId: "house-1",
    profileId: "prof-1",
    recordType: "blood_glucose",
    recordedAt: "2025-07-15T08:00:00Z",
    source: "manual",
    sourceDocumentId: null,
    deletedAt: null,
    createdAt: "2025-07-15T08:00:00Z",
    updatedAt: "2025-07-15T08:00:00Z",
    version: 1,
    payload: {
      value: 112,
      timing: "fasting",
    },
  },
  {
    id: "rec-3",
    householdId: "house-1",
    profileId: "prof-1",
    recordType: "blood_pressure",
    recordedAt: "2026-08-22T09:00:00Z",
    source: "manual",
    sourceDocumentId: null,
    deletedAt: null,
    createdAt: "2026-08-22T09:00:00Z",
    updatedAt: "2026-08-22T09:00:00Z",
    version: 1,
    payload: {
      systolic: 124,
      diastolic: 80,
      note: "안정 시 측정",
    },
  },
  {
    id: "rec-4",
    householdId: "house-1",
    profileId: "prof-1",
    recordType: "pain",
    recordedAt: "2026-08-19T14:00:00Z",
    source: "local_ai",
    sourceDocumentId: null,
    deletedAt: null,
    createdAt: "2026-08-19T14:00:00Z",
    updatedAt: "2026-08-19T14:00:00Z",
    version: 1,
    payload: {
      bodyArea: "오른쪽 무릎",
      intensity: 6,
      sensation: "욱신거림",
      note: "계단 내려갈 때 욱신거림",
    },
  },
  {
    id: "rec-5",
    householdId: "house-1",
    profileId: "prof-1",
    recordType: "health_screening",
    recordedAt: "2026-08-10T10:00:00Z",
    source: "ocr",
    sourceDocumentId: null,
    deletedAt: null,
    createdAt: "2026-08-10T10:00:00Z",
    updatedAt: "2026-08-10T10:00:00Z",
    version: 1,
    payload: {
      screeningName: "2026년 국민건강검진",
      institution: "이어봄의원",
      note: "혈압 120/80, 시력 1.0",
    },
  },
];

describe("healthAssistantRAG", () => {
  it("혈당 수치 질의 시 최신 수치와 직전 대비 변화량을 정확히 요약한다", () => {
    const res = queryLocalHealthRAG("지난번 공복혈당 얼마였지?", mockRecords, "홍길동");
    expect(res.category).toBe("blood_glucose");
    expect(res.answer).toContain("105 mg/dL");
    expect(res.answer).toContain("2026-08-20");
    expect(res.answer).toContain("직전 공복혈당 대비 -7 mg/dL 감소");
    expect(res.matchedRecords.length).toBeGreaterThan(0);
  });

  it("혈압 수치 질의 시 최신 수축기/이완기 수치를 요약한다", () => {
    const res = queryLocalHealthRAG("최근 혈압 기록 알려줘", mockRecords, "홍길동");
    expect(res.category).toBe("blood_pressure");
    expect(res.answer).toContain("124/80 mmHg");
    expect(res.answer).toContain("2026-08-22");
  });

  it("통증 질의 시 해당 부위의 발생 일자와 강도, 양상을 요약한다", () => {
    const res = queryLocalHealthRAG("무릎 아팠던 적 있어?", mockRecords, "홍길동");
    expect(res.category).toBe("pain");
    expect(res.answer).toContain("오른쪽 무릎");
    expect(res.answer).toContain("강도 6/10");
    expect(res.answer).toContain("욱신거림");
  });

  it("검진 질의 시 검진명과 일자를 요약한다", () => {
    const res = queryLocalHealthRAG("검진 언제 받았어?", mockRecords, "홍길동");
    expect(res.category).toBe("screening");
    expect(res.answer).toContain("2026년 국민건강검진");
    expect(res.answer).toContain("2026-08-10");
  });

  it("기록이 없는 항목에 대해 친절한 안내를 반환한다", () => {
    const res = queryLocalHealthRAG("체중 얼마야?", [], "홍길동");
    expect(res.answer).toContain("저장된 체중/신체 측정 기록이 없습니다");
  });

  it("valueMgDl 필드로 저장된 과거 혈당 기록도 undefined 없이 수치를 추출한다", () => {
    const legacyRecords: HealthRecord[] = [
      {
        id: "rec-legacy",
        householdId: "house-1",
        profileId: "prof-1",
        recordType: "blood_glucose",
        recordedAt: "2026-08-25T12:00:00Z",
        source: "manual",
        sourceDocumentId: null,
        deletedAt: null,
        createdAt: "2026-08-25T12:00:00Z",
        updatedAt: "2026-08-25T12:00:00Z",
        version: 1,
        payload: {
          valueMgDl: 98,
          timing: "fasting",
        },
      },
    ];

    const res = queryLocalHealthRAG("가장 마지막의 공복혈당이 얼ㄹ마야", legacyRecords, "홍길동");
    expect(res.category).toBe("blood_glucose");
    expect(res.answer).toContain("98 mg/dL");
    expect(res.answer).not.toContain("undefined");
  });

  describe("정확성 보완 반례 테스트 (Counter-example Tests)", () => {
    // 1. 최신 식후혈당이 있어도 "공복혈당" 질문에는 공복 기록만 답한다.
    it("1. 최신 식후혈당이 있어도 '공복혈당' 질문에는 공복 기록만 답한다", () => {
      const mixedRecords: HealthRecord[] = [
        {
          id: "rec-post",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "blood_glucose",
          recordedAt: "2026-08-25T13:00:00Z", // 더 최신
          source: "manual",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2026-08-25T13:00:00Z",
          updatedAt: "2026-08-25T13:00:00Z",
          version: 1,
          payload: { value: 160, timing: "after_meal" },
        },
        {
          id: "rec-fast",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "blood_glucose",
          recordedAt: "2026-08-25T08:00:00Z",
          source: "manual",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2026-08-25T08:00:00Z",
          updatedAt: "2026-08-25T08:00:00Z",
          version: 1,
          payload: { value: 95, timing: "fasting" },
        },
      ];

      const res = queryLocalHealthRAG("지난번 공복혈당 얼마였지?", mixedRecords, "홍길동");
      expect(res.answer).toContain("95 mg/dL");
      expect(res.answer).toContain("공복혈당");
      expect(res.answer).not.toContain("160");
      expect(res.matchedRecords[0].id).toBe("rec-fast");
    });

    // 2. 공복혈당 기록이 없을 때 식후혈당으로 대신 답하지 않는다.
    it("2. 공복혈당 기록이 없을 때 식후혈당으로 대신 답하지 않는다", () => {
      const postprandialOnly: HealthRecord[] = [
        {
          id: "rec-post-only",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "blood_glucose",
          recordedAt: "2026-08-25T13:00:00Z",
          source: "manual",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2026-08-25T13:00:00Z",
          updatedAt: "2026-08-25T13:00:00Z",
          version: 1,
          payload: { value: 145, timing: "after_meal" },
        },
      ];

      const res = queryLocalHealthRAG("공복혈당 얼마야?", postprandialOnly, "홍길동");
      expect(res.answer).toContain("공복혈당 기록을 찾지 못했습니다");
      expect(res.matchedRecords.length).toBe(0);
      expect(res.answer).not.toContain("145");
    });

    // 3. "혈당 105 mg/dL"이 아닌 LDL 또는 콜레스테롤 mg/dL 메모를 혈당으로 오인하지 않는다.
    it("3. LDL 또는 콜레스테롤 mg/dL 메모를 혈당으로 오인하지 않는다", () => {
      const lipidNoteRecords: HealthRecord[] = [
        {
          id: "rec-lipid",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "health_screening",
          recordedAt: "2026-08-20T10:00:00Z",
          source: "ocr",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2026-08-20T10:00:00Z",
          updatedAt: "2026-08-20T10:00:00Z",
          version: 1,
          payload: {
            screeningName: "검진 결과",
            note: "LDL 콜레스테롤 130 mg/dL, 총콜레스테롤 210 mg/dL, 중성지방 150 mg/dL",
          },
        },
      ];

      const res = queryLocalHealthRAG("혈당 얼마였지?", lipidNoteRecords, "홍길동");
      expect(res.answer).toContain("저장된 혈당 기록이 아직 없습니다");
      expect(res.matchedRecords.length).toBe(0);
      expect(res.answer).not.toContain("130");
      expect(res.answer).not.toContain("210");
    });

    // 4. 공복혈당 변화량은 공복혈당끼리만 비교한다.
    it("4. 공복혈당 변화량은 공복혈당끼리만 비교한다", () => {
      const recordsWithInterleavedTiming: HealthRecord[] = [
        {
          id: "rec-fast-2",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "blood_glucose",
          recordedAt: "2026-08-25T08:00:00Z",
          source: "manual",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2026-08-25T08:00:00Z",
          updatedAt: "2026-08-25T08:00:00Z",
          version: 1,
          payload: { value: 100, timing: "fasting" },
        },
        {
          id: "rec-post-interleaved",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "blood_glucose",
          recordedAt: "2026-08-24T13:00:00Z",
          source: "manual",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2026-08-24T13:00:00Z",
          updatedAt: "2026-08-24T13:00:00Z",
          version: 1,
          payload: { value: 170, timing: "after_meal" },
        },
        {
          id: "rec-fast-1",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "blood_glucose",
          recordedAt: "2026-08-23T08:00:00Z",
          source: "manual",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2026-08-23T08:00:00Z",
          updatedAt: "2026-08-23T08:00:00Z",
          version: 1,
          payload: { value: 110, timing: "fasting" },
        },
      ];

      const res = queryLocalHealthRAG("공복혈당 얼마야?", recordsWithInterleavedTiming, "홍길동");
      expect(res.answer).toContain("100 mg/dL");
      // 100 - 110 = -10 (중간의 170과 비교하지 않음)
      expect(res.answer).toContain("직전 공복혈당 대비 -10 mg/dL 감소");
      expect(res.answer).not.toContain("-70");
    });

    // 5. "작년 검진" 질문은 작년 기록만 답한다.
    it("5. '작년 검진' 질문은 작년 기록만 답한다", () => {
      const screeningHistory: HealthRecord[] = [
        {
          id: "scr-2026",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "health_screening",
          recordedAt: "2026-05-10T10:00:00Z",
          source: "ocr",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2026-05-10T10:00:00Z",
          updatedAt: "2026-05-10T10:00:00Z",
          version: 1,
          payload: { screeningName: "2026 정기종합검진" },
        },
        {
          id: "scr-2025",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "health_screening",
          recordedAt: "2025-11-20T10:00:00Z",
          source: "ocr",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2025-11-20T10:00:00Z",
          updatedAt: "2025-11-20T10:00:00Z",
          version: 1,
          payload: { screeningName: "2025 국가일반검진" },
        },
      ];

      const refDate = new Date("2026-08-25T00:00:00Z");
      const res = queryLocalHealthRAG("작년 검진 언제 받았어?", screeningHistory, "홍길동", refDate);
      expect(res.answer).toContain("2025-11-20");
      expect(res.answer).toContain("2025 국가일반검진");
      expect(res.answer).not.toContain("2026 정기종합검진");
      expect(res.matchedRecords[0].id).toBe("scr-2025");
    });

    // 6. "2025년 검진" 질문은 2025년 기록만 답한다.
    it("6. '2025년 검진' 질문은 2025년 기록만 답한다", () => {
      const screeningHistory: HealthRecord[] = [
        {
          id: "scr-2026",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "health_screening",
          recordedAt: "2026-05-10T10:00:00Z",
          source: "ocr",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2026-05-10T10:00:00Z",
          updatedAt: "2026-05-10T10:00:00Z",
          version: 1,
          payload: { screeningName: "2026 정기종합검진" },
        },
      ];

      const refDate = new Date("2026-08-25T00:00:00Z");
      const res = queryLocalHealthRAG("2025년 검진 보여줘", screeningHistory, "홍길동", refDate);
      expect(res.answer).toContain("2025년에 저장된 건강검진 및 서류 기록을 찾지 못했습니다");
      expect(res.matchedRecords.length).toBe(0);
      expect(res.answer).not.toContain("2026 정기종합검진");
    });

    // 7. 삭제된 기록은 검색 결과와 matchedRecords에 포함되지 않는다.
    it("7. 삭제된 기록은 검색 결과와 matchedRecords에 포함되지 않는다", () => {
      const recordsWithDeleted: HealthRecord[] = [
        {
          id: "rec-deleted-latest",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "blood_pressure",
          recordedAt: "2026-08-25T15:00:00Z",
          source: "manual",
          sourceDocumentId: null,
          deletedAt: "2026-08-25T15:30:00Z", // 삭제됨
          createdAt: "2026-08-25T15:00:00Z",
          updatedAt: "2026-08-25T15:30:00Z",
          version: 2,
          payload: { systolic: 180, diastolic: 110 },
        },
        {
          id: "rec-active-bp",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "blood_pressure",
          recordedAt: "2026-08-24T09:00:00Z",
          source: "manual",
          sourceDocumentId: null,
          deletedAt: null, // 활성
          createdAt: "2026-08-24T09:00:00Z",
          updatedAt: "2026-08-24T09:00:00Z",
          version: 1,
          payload: { systolic: 120, diastolic: 80 },
        },
      ];

      const res = queryLocalHealthRAG("혈압 얼마야?", recordsWithDeleted, "홍길동");
      expect(res.answer).toContain("120/80 mmHg");
      expect(res.answer).not.toContain("180/110");
      expect(res.matchedRecords.some((r) => r.id === "rec-deleted-latest")).toBe(false);
      expect(res.matchedRecords[0].id).toBe("rec-active-bp");
    });

    // 8. 일반 fallback의 matchedRecords는 최신순이다.
    it("8. 일반 fallback의 matchedRecords는 최신순이다", () => {
      const recordsUnsorted: HealthRecord[] = [
        {
          id: "rec-old",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "body_measurement",
          recordedAt: "2024-01-01T00:00:00Z",
          source: "manual",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
          version: 1,
          payload: { weightKg: 70 },
        },
        {
          id: "rec-new",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "body_measurement",
          recordedAt: "2026-08-25T00:00:00Z",
          source: "manual",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2026-08-25T00:00:00Z",
          updatedAt: "2026-08-25T00:00:00Z",
          version: 1,
          payload: { weightKg: 68 },
        },
      ];

      const res = queryLocalHealthRAG("내 건강 요약해줘", recordsUnsorted, "홍길동");
      expect(res.category).toBe("general");
      expect(res.matchedRecords[0].id).toBe("rec-new");
      expect(res.matchedRecords[1].id).toBe("rec-old");
    });

    // 9. 공복혈당 기록 1개만 있는 경우, "식후혈당은?" 질문은 식후 기록이 없다고 답한다.
    it("9. 공복혈당 기록 1개만 있는 경우, '식후혈당은?' 질문은 식후 기록이 없다고 답한다", () => {
      const fastingOnly: HealthRecord[] = [
        {
          id: "rec-fast-single",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "blood_glucose",
          recordedAt: "2026-08-25T08:00:00Z",
          source: "manual",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2026-08-25T08:00:00Z",
          updatedAt: "2026-08-25T08:00:00Z",
          version: 1,
          payload: { value: 117, timing: "fasting" },
        },
      ];

      const res = queryLocalHealthRAG("식후혈당은?", fastingOnly, "다원");
      expect(res.answer).toContain("저장된 식후혈당 기록을 찾지 못했습니다");
      expect(res.matchedRecords.length).toBe(0);
      expect(res.metricSummary).toBeUndefined();
    });

    // 10. 식후혈당 기록 1개만 있는 경우, "공복혈당은?" 질문은 공복 기록이 없다고 답한다.
    it("10. 식후혈당 기록 1개만 있는 경우, '공복혈당은?' 질문은 공복 기록이 없다고 답한다", () => {
      const postprandialOnly: HealthRecord[] = [
        {
          id: "rec-post-single",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "blood_glucose",
          recordedAt: "2026-08-25T13:00:00Z",
          source: "manual",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2026-08-25T13:00:00Z",
          updatedAt: "2026-08-25T13:00:00Z",
          version: 1,
          payload: { value: 117, timing: "after_meal" },
        },
      ];

      const res = queryLocalHealthRAG("공복혈당은?", postprandialOnly, "다원");
      expect(res.answer).toContain("저장된 공복혈당 기록을 찾지 못했습니다");
      expect(res.matchedRecords.length).toBe(0);
      expect(res.metricSummary).toBeUndefined();
    });

    // 11. 공복·식후 기록이 각각 존재하고 값과 날짜가 우연히 같더라도, 각 질문의 matchedRecords[0].id가 서로 다른 실제 기록인지 확인한다.
    it("11. 공복·식후 기록의 값과 날짜가 같아도 질문에 따라 알맞은 실제 기록을 반환한다", () => {
      const sameValueAndDateRecords: HealthRecord[] = [
        {
          id: "rec-fast-117",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "blood_glucose",
          recordedAt: "2026-08-25T08:00:00Z",
          source: "manual",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2026-08-25T08:00:00Z",
          updatedAt: "2026-08-25T08:00:00Z",
          version: 1,
          payload: { value: 117, timing: "fasting" },
        },
        {
          id: "rec-post-117",
          householdId: "house-1",
          profileId: "prof-1",
          recordType: "blood_glucose",
          recordedAt: "2026-08-25T13:00:00Z",
          source: "ocr",
          sourceDocumentId: null,
          deletedAt: null,
          createdAt: "2026-08-25T13:00:00Z",
          updatedAt: "2026-08-25T13:00:00Z",
          version: 1,
          payload: { value: 117, timing: "after_meal" },
        },
      ];

      const fastRes = queryLocalHealthRAG("지난번 공복혈당 얼마나 나왔지?", sameValueAndDateRecords, "다원");
      expect(fastRes.matchedRecords[0].id).toBe("rec-fast-117");
      expect(fastRes.metricSummary?.label).toBe("공복혈당");
      expect(fastRes.metricSummary?.evidenceText).toBe("근거: 수기 입력 · 공복혈당 · 2026-08-25");

      const postRes = queryLocalHealthRAG("식후혈당은?", sameValueAndDateRecords, "다원");
      expect(postRes.matchedRecords[0].id).toBe("rec-post-117");
      expect(postRes.metricSummary?.label).toBe("식후혈당");
      expect(postRes.metricSummary?.evidenceText).toBe("근거: OCR 확정 기록 · 식후혈당 · 2026-08-25");
    });

    // 12. 생성되는 모든 답변 문자열에 ** 마크다운이 포함되지 않는지 확인한다.
    it("12. 생성되는 모든 답변 문자열에 ** 마크다운이 포함되지 않는다", () => {
      const queries = [
        "지난번 공복혈당 얼마였지?",
        "최근 혈압 기록 알려줘",
        "무릎 아팠던 적 있어?",
        "검진 언제 받았어?",
        "몸무게 얼마야?",
      ];

      for (const q of queries) {
        const res = queryLocalHealthRAG(q, mockRecords, "홍길동");
        expect(res.answer).not.toContain("**");
      }
    });
  });
});
