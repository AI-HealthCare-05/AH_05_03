import { describe, expect, it } from "vitest";
import { parseHealthIntent } from "./healthAssistantParser";

describe("healthAssistantParser", () => {
  describe("수치 기록 의도 감지 (Metric Entry Intent)", () => {
    it("혈당 문장을 감지하고 수치와 시점을 추출한다", () => {
      const res = parseHealthIntent("오늘 아침 공복혈당 105 나왔어");
      expect(res.intent).toBe("record_blood_glucose");
      expect(res.metricData?.glucose).toBe(105);
      expect(res.metricData?.timing).toBe("fasting");
      expect(res.confirmationMessage).toContain("105 mg/dL");
      expect(res.confirmationMessage).toContain("기록할까요?");
    });

    it("식후 혈당 문장을 감지한다", () => {
      const res = parseHealthIntent("점심 식후 혈당 142");
      expect(res.intent).toBe("record_blood_glucose");
      expect(res.metricData?.glucose).toBe(142);
      expect(res.metricData?.timing).toBe("after_meal");
    });

    it("오전에 혈당검사했는데 110이었어 문장을 감지하고 시간대와 후보 시간을 추출한다", () => {
      const res = parseHealthIntent("오전에 혈당검사했는데, 110이었어");
      expect(res.intent).toBe("record_blood_glucose");
      expect(res.metricData?.glucose).toBe(110);
      expect(res.metricData?.timeSlot).toBe("morning");
      expect(res.metricData?.suggestedHours).toContain("09:00");
      expect(res.metricData?.timingAmbiguous).toBe(true);
    });

    it("어제 혈당 120나왔어 문장에서 어제 날짜를 정확히 추출한다", () => {
      const res = parseHealthIntent("어제 혈당 120나왔어");
      expect(res.intent).toBe("record_blood_glucose");
      expect(res.metricData?.glucose).toBe(120);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

      expect(res.metricData?.selectedDate).toBe(yStr);
      expect(res.metricData?.dateLabel).toContain("어제");
    });

    it("내일 공복혈당 100이야 와 같은 미래 일자 수치 기록 입력을 거부한다", () => {
      const res = parseHealthIntent("내일 공복혈당 100이야");
      expect(res.intent).toBe("general_help");
      expect(res.confirmationMessage).toContain("미래 일자의 건강 수치는 기록할 수 없습니다");
      expect(res.metricData).toBeUndefined();
    });

    it("오늘 오전 혈당은 115였어 문장을 정확히 감지한다", () => {
      const res = parseHealthIntent("오늘 오전 혈당은 115였어");
      expect(res.intent).toBe("record_blood_glucose");
      expect(res.metricData?.glucose).toBe(115);
      expect(res.metricData?.timeSlot).toBe("morning");
    });

    it("혈압 문장을 감지하고 수축기/이완기를 추출한다", () => {
      const res = parseHealthIntent("방금 쟀는데 혈압 125에 82 나왔어");
      expect(res.intent).toBe("record_blood_pressure");
      expect(res.metricData?.systolic).toBe(125);
      expect(res.metricData?.diastolic).toBe(82);
      expect(res.confirmationMessage).toContain("125 / 이완기 82 mmHg");
    });

    it("슬래시 형식의 혈압 문장을 감지한다", () => {
      const res = parseHealthIntent("130/85");
      expect(res.intent).toBe("record_blood_pressure");
      expect(res.metricData?.systolic).toBe(130);
      expect(res.metricData?.diastolic).toBe(85);
    });

    it("80/130 처럼 최저/최고 혈압이 뒤바뀌어 입력되어도 큰 값을 수축기, 작은 값을 이완기로 자동 보정한다", () => {
      const res = parseHealthIntent("혈압 80/130 나왔어");
      expect(res.intent).toBe("record_blood_pressure");
      expect(res.metricData?.systolic).toBe(130);
      expect(res.metricData?.diastolic).toBe(80);
      expect(res.confirmationMessage).toContain("수축기 130 / 이완기 80 mmHg");
    });

    it("체중 문장을 감지하고 kg 수치를 추출한다", () => {
      const res = parseHealthIntent("오늘 몸무게 71.5kg 찍힘");
      expect(res.intent).toBe("record_body_measurement");
      expect(res.metricData?.weightKg).toBe(71.5);
      expect(res.confirmationMessage).toContain("71.5 kg");
    });

    it("혈당과 혈압이 한 문장에 동시에 포함된 경우 복합 수치를 모두 추출한다", () => {
      const res = parseHealthIntent("오늘 아침 혈당은 90, 혈압은 90/120");
      expect(res.metricData?.glucose).toBe(90);
      expect(res.metricData?.systolic).toBe(120);
      expect(res.metricData?.diastolic).toBe(90);
      expect(res.metricData?.hasMultipleMetrics).toBe(true);
      expect(res.confirmationMessage).toContain("공복혈당 90 mg/dL");
      expect(res.confirmationMessage).toContain("수축기 120 / 이완기 90 mmHg 혈압");
      expect(res.confirmationMessage).toContain("함께 기록할까요?");
    });
  });

  describe("통증 기록 의도 감지 (Pain Entry Intent)", () => {
    it("방향이 포함된 신체 부위와 통증 양상을 감지한다", () => {
      const res = parseHealthIntent("어제부터 오른쪽 무릎이 욱신거려");
      expect(res.intent).toBe("record_pain");
      expect(res.painData?.bodyArea).toBe("오른쪽 무릎");
      expect(res.painData?.sensation).toBe("욱신");
      expect(res.confirmationMessage).toContain("오른쪽 무릎 통증 기록을 작성할까요?");
    });

    it("일반 부위 통증 문장을 감지한다", () => {
      const res = parseHealthIntent("허리가 너무 뻐근하고 아파요");
      expect(res.intent).toBe("record_pain");
      expect(res.painData?.bodyArea).toBe("허리");
      expect(res.confirmationMessage).toContain("허리 통증 기록을 작성할까요?");
    });
  });

  describe("서류 업로드 의도 감지 (OCR Intent)", () => {
    it("검진표 등록 문장을 감지한다", () => {
      const res = parseHealthIntent("검진 결과지 사진 올릴래");
      expect(res.intent).toBe("record_ocr");
      expect(res.confirmationMessage).toContain("검진 결과지 문서를 등록하고 기록할까요?");
    });
  });

  describe("기록 검색 질의 감지 (Query Intent - Local RAG)", () => {
    it("혈당 질의 문장을 검색 의도로 감지한다", () => {
      const res = parseHealthIntent("지난번 공복혈당 얼마였지?");
      expect(res.intent).toBe("query_metric");
    });

    it("오타나 어미 변형이 있는 혈당 질의 문장을 검색 의도로 감지한다", () => {
      const res = parseHealthIntent("가장 마지막의 공복혈당이 얼ㄹ마야");
      expect(res.intent).toBe("query_metric");
    });

    it("혈압 질의 문장을 검색 의도로 감지한다", () => {
      const res = parseHealthIntent("최근 혈압 기록 보여줘");
      expect(res.intent).toBe("query_metric");
    });

    it("통증 질의 문장을 검색 의도로 감지한다", () => {
      const res = parseHealthIntent("무릎 아팠던 적 언제야?");
      expect(res.intent).toBe("query_pain");
    });

    it("검진 질의 문장을 검색 의도로 감지한다", () => {
      const res = parseHealthIntent("작년에 건강검진 언제 받았어?");
      expect(res.intent).toBe("query_screening");
    });
  });
});
