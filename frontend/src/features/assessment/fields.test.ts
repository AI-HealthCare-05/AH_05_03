/**
 * 폼 계약 — 서버 오류를 칸으로 되돌리고, 지난 판정을 폼으로 되불러온다.
 *
 * 둘 다 **조용히 틀리는** 자리다. 잘못돼도 화면은 아무 오류를 내지 않고, 사용자는
 * 엉뚱한 칸이 빨갛거나 값이 안 채워지는 것만 본다.
 */

import { describe, expect, it } from "vitest";

import {
  calculateAgeFromBirthDate,
  CHECKUP_FIELDS,
  profileGenderToSex,
  rejectedFields,
  valuesFromInputs,
} from "./fields";

describe("서버 422 → 고칠 칸", () => {
  it("아는 필드만 잡는다", () => {
    const found = rejectedFields(
      "hba1c: Input should be less than or equal to 20; hemoglobin: Input should be less than or equal to 25",
    );
    expect(Object.keys(found).sort()).toEqual(["hba1c", "hemoglobin"]);
  });

  it("영어 원문이 아니라 허용 범위를 말한다", () => {
    const found = rejectedFields("hba1c: Input should be less than or equal to 20");
    expect(found.hba1c).toBe("2~20 % 사이여야 해요");
  });

  it("모르는 이름은 칸으로 만들지 않는다", () => {
    // 서버 문구가 바뀌어도 엉뚱한 칸을 빨갛게 칠하면 안 된다.
    expect(rejectedFields("weird_field: Input should be a number")).toEqual({});
    expect(rejectedFields("알 수 없는 오류")).toEqual({});
  });
});

describe("지난 판정 → 폼 값", () => {
  it("전부 문자열로 바꾼다", () => {
    // 폼 상태는 전부 문자열이다. 숫자를 그대로 넣으면 input 이 값을 못 받는다.
    expect(valuesFromInputs({ age: 54, sex: "M", is_fasting: true })).toEqual({
      age: "54",
      sex: "M",
      is_fasting: "true",
    });
  });

  it("빈 값은 키째 뺀다", () => {
    // `toRequestBody` 는 빈 문자열을 안 보내지만, 남겨 두면 폼이 "채워진 칸" 으로 센다.
    expect(valuesFromInputs({ age: 54, sbp: "", ldl: null as never })).toEqual({ age: "54" });
  });

  it("숫자가 아닌 수는 버린다", () => {
    // 옛 기록에 NaN 이 들어간 적이 있다. 그대로 넣으면 폼에 "NaN" 이 찍힌다.
    expect(valuesFromInputs({ age: 54, hdl: Number.NaN, ldl: Number.POSITIVE_INFINITY })).toEqual({
      age: "54",
    });
  });
});

describe("생년월일 → 만 나이 계산", () => {
  const referenceDate = new Date(2026, 8, 6); // 2026-09-06

  it("생일이 지난 경우 만 나이를 올바르게 계산한다", () => {
    expect(calculateAgeFromBirthDate("1988-05-10", referenceDate)).toBe(38);
  });

  it("생일이 아직 안 지난 경우 1세를 뺀다", () => {
    expect(calculateAgeFromBirthDate("1988-10-28", referenceDate)).toBe(37);
  });

  it("생일 당일인 경우 만 나이를 반영한다", () => {
    expect(calculateAgeFromBirthDate("1988-09-06", referenceDate)).toBe(38);
  });

  it("연도만 있는 경우 연도 차이로 계산한다", () => {
    expect(calculateAgeFromBirthDate("1988", referenceDate)).toBe(38);
  });

  it("잘못된 형식은 undefined를 반환한다", () => {
    expect(calculateAgeFromBirthDate("")).toBeUndefined();
    expect(calculateAgeFromBirthDate("invalid-date")).toBeUndefined();
  });
});

describe("프로필 성별 → 폼 성별 변환", () => {
  it("male을 M으로 변환한다", () => {
    expect(profileGenderToSex("male")).toBe("M");
  });

  it("female을 F로 변환한다", () => {
    expect(profileGenderToSex("female")).toBe("F");
  });

  it("null/undefined/알 수 없는 값은 undefined를 반환한다", () => {
    expect(profileGenderToSex(null)).toBeUndefined();
    expect(profileGenderToSex(undefined)).toBeUndefined();
    expect(profileGenderToSex("other")).toBeUndefined();
  });
});

/**
 * 검진 수치 목록이 무엇을 담고 무엇을 안 담는가.
 *
 * 실측으로 항목별 변화 그래프에 **나이가 26 → 52 → 61 → 26** 으로 그려졌다.
 * 프리셋을 바꿔 가며 판정한 흔적인데 그래프는 그걸 "나이가 오르내렸다" 로 보여 준다.
 */
describe("CHECKUP_FIELDS", () => {
  it("검진결과지에 인쇄되는 값만 담는다", () => {
    for (const name of ["hba1c", "total_chol", "hdl", "ldl", "triglyceride", "ast", "alt", "ggt", "uric_acid", "creatinine", "hemoglobin", "albumin", "urine_acr", "crp", "ogtt_2h"]) {
      expect(CHECKUP_FIELDS.has(name), name).toBe(true);
    }
    // 허리둘레는 검진에서 잰다. 기본 그룹이지만 예외로 넣는다.
    expect(CHECKUP_FIELDS.has("waist_cm")).toBe(true);
  });

  it("나이·키·주관 평가·생활습관·진단 이력은 담지 않는다", () => {
    for (const name of [
      "age",
      "height_cm",
      "self_rated_health",
      "sleep_hours",
      "alcohol_days_per_year",
      "moderate_min_per_week",
      "vigorous_min_per_week",
      "sedentary_min_per_day",
      "smoking_status",
      "has_diabetes",
      "is_fasting",
    ]) {
      expect(CHECKUP_FIELDS.has(name), name).toBe(false);
    }
  });
});
