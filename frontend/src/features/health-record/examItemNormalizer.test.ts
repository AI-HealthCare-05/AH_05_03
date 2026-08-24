import { describe, expect, it } from "vitest";
import {
  isUnitCompatible,
  normalizeExamItem,
  normalizeString,
  normalizeUnit,
} from "./examItemNormalizer";

describe("examItemNormalizer", () => {
  it("FBS와 공복혈당이 같은 표준 항목('공복혈당')으로 정리된다", () => {
    const fbs = normalizeExamItem("FBS", "mg/dL");
    const fasting = normalizeExamItem("공복혈당", "mg/dL");
    const fastingWithSpace = normalizeExamItem("공복 혈당", "mg/dl");
    const fbg = normalizeExamItem("fasting blood glucose", "mg/dL");
    const beforeMeal = normalizeExamItem("식전혈당", "mg/dL");

    expect(fbs.canonicalName).toBe("공복혈당");
    expect(fasting.canonicalName).toBe("공복혈당");
    expect(fastingWithSpace.canonicalName).toBe("공복혈당");
    expect(fbg.canonicalName).toBe("공복혈당");
    expect(beforeMeal.canonicalName).toBe("공복혈당");

    expect(fbs.category).toBe("blood_glucose");
    expect(fbs.unit).toBe("mg/dL");
  });

  it("식후혈당과 공복혈당이 서로 다른 시계열 항목으로 엄격히 분리된다", () => {
    const fasting = normalizeExamItem("공복혈당", "mg/dL");
    const postprandial = normalizeExamItem("식후혈당", "mg/dL");
    const pp2 = normalizeExamItem("PP2", "mg/dL");
    const postMeal = normalizeExamItem("식후 2시간 혈당", "mg/dL");

    expect(fasting.canonicalName).toBe("공복혈당");
    expect(postprandial.canonicalName).toBe("식후혈당");
    expect(pp2.canonicalName).toBe("식후혈당");
    expect(postMeal.canonicalName).toBe("식후혈당");

    // 공복혈당과 식후혈당의 canonicalName이 절대 같지 않아야 함
    expect(fasting.canonicalName).not.toBe(postprandial.canonicalName);
  });

  it("HbA1c(당화혈색소)가 일반 혈당 그래프에 섞이지 않고 독립된 지표로 매핑된다", () => {
    const hba1c = normalizeExamItem("HbA1c", "%");
    const korean = normalizeExamItem("당화혈색소", "%");
    const english = normalizeExamItem("hemoglobin A1c", "%");
    const fasting = normalizeExamItem("공복혈당", "mg/dL");

    expect(hba1c.canonicalName).toBe("당화혈색소 (HbA1c)");
    expect(korean.canonicalName).toBe("당화혈색소 (HbA1c)");
    expect(english.canonicalName).toBe("당화혈색소 (HbA1c)");

    expect(hba1c.standardUnit).toBe("%");
    expect(hba1c.canonicalName).not.toBe(fasting.canonicalName);
  });

  it("수축기 혈압(SBP)과 이완기 혈압(DBP)이 서로 다른 시계열로 명확히 분리된다", () => {
    const sbp = normalizeExamItem("수축기 혈압", "mmHg");
    const sbpAlias = normalizeExamItem("SBP", "mmHg");
    const dbp = normalizeExamItem("이완기 혈압", "mmHg");
    const dbpAlias = normalizeExamItem("DBP", "mmHg");

    expect(sbp.canonicalName).toBe("수축기 혈압");
    expect(sbpAlias.canonicalName).toBe("수축기 혈압");
    expect(dbp.canonicalName).toBe("이완기 혈압");
    expect(dbpAlias.canonicalName).toBe("이완기 혈압");

    expect(sbp.canonicalName).not.toBe(dbp.canonicalName);
  });

  it("주요 간기능/지질/신장 검사 항목들이 표준 항목으로 정상 매핑된다", () => {
    expect(normalizeExamItem("AST(SGOT)").canonicalName).toBe("AST (SGOT)");
    expect(normalizeExamItem("ALT (SGPT)").canonicalName).toBe("ALT (SGPT)");
    expect(normalizeExamItem("γ-GTP").canonicalName).toBe("감마지티피 (γ-GTP)");
    expect(normalizeExamItem("r-GTP").canonicalName).toBe("감마지티피 (γ-GTP)");
    expect(normalizeExamItem("Total cholesterol").canonicalName).toBe("총콜레스테롤");
    expect(normalizeExamItem("HDL-C").canonicalName).toBe("HDL 콜레스테롤");
    expect(normalizeExamItem("LDL-C").canonicalName).toBe("LDL 콜레스테롤");
    expect(normalizeExamItem("Triglyceride").canonicalName).toBe("중성지방 (TG)");
    expect(normalizeExamItem("Creatinine").canonicalName).toBe("혈청 크레아티닌");
    expect(normalizeExamItem("e-GFR").canonicalName).toBe("신사구체여과율 (e-GFR)");
    expect(normalizeExamItem("사구체여과율").canonicalName).toBe("신사구체여과율 (e-GFR)");
  });

  it("알 수 없거나 애매한 검사명은 삭제되지 않고 원본 그대로 보존되며 unrecognized 메타데이터를 갖는다", () => {
    const customTest = normalizeExamItem("비타민D 검사 (25-OH-D)", "ng/mL");

    expect(customTest.canonicalName).toBe("비타민D 검사 (25-OH-D)");
    expect(customTest.rawName).toBe("비타민D 검사 (25-OH-D)");
    expect(customTest.category).toBe("other");
    expect(customTest.matchType).toBe("unrecognized");
    expect(customTest.unit).toBe("ng/mL");
  });

  it("단위 정규화 및 단위 호환성 검사가 동작하여 다른 단위의 믹싱을 방어한다", () => {
    expect(normalizeUnit("mg/dl")).toBe("mg/dL");
    expect(normalizeUnit("MG/DL")).toBe("mg/dL");
    expect(normalizeUnit("u/l")).toBe("U/L");
    expect(normalizeUnit("mmhg")).toBe("mmHg");

    // 동일 단위 호환성
    expect(isUnitCompatible("mg/dL", "mg/dl")).toBe(true);
    expect(isUnitCompatible("mmHg", "mmhg")).toBe(true);

    // 서로 다른 단위 비호환성
    expect(isUnitCompatible("mg/dL", "%")).toBe(false);
    expect(isUnitCompatible("mg/dL", "mmol/L")).toBe(false);
    expect(isUnitCompatible("U/L", "mg/dL")).toBe(false);
  });
});
