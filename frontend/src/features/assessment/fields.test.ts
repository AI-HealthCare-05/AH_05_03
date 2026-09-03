/**
 * 폼 계약 — 서버 오류를 칸으로 되돌리고, 지난 판정을 폼으로 되불러온다.
 *
 * 둘 다 **조용히 틀리는** 자리다. 잘못돼도 화면은 아무 오류를 내지 않고, 사용자는
 * 엉뚱한 칸이 빨갛거나 값이 안 채워지는 것만 본다.
 */

import { describe, expect, it } from "vitest";

import { rejectedFields, valuesFromInputs } from "./fields";

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
