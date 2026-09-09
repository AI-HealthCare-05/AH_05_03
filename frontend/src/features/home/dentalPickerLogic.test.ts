import { describe, expect, it } from "vitest";
import {
  ADULT_TEETH,
  getToothByFdi,
  getTeethByQuadrant,
  matchToothFromQuery,
} from "./dentalPickerLogic";

describe("dentalPickerLogic", () => {
  it("32개 성인 영구치 목록이 정확히 정의되어 있다", () => {
    expect(ADULT_TEETH).toHaveLength(32);
    // 4개 분면 각각 8개씩
    expect(getTeethByQuadrant("upper-right")).toHaveLength(8);
    expect(getTeethByQuadrant("upper-left")).toHaveLength(8);
    expect(getTeethByQuadrant("lower-left")).toHaveLength(8);
    expect(getTeethByQuadrant("lower-right")).toHaveLength(8);
  });

  it("FDI 치아 번호로 치아 정보를 검색한다", () => {
    const tooth16 = getToothByFdi(16);
    expect(tooth16).toBeDefined();
    expect(tooth16?.koreanName).toContain("상악 우측 제1대구치");
    expect(tooth16?.type).toBe("molar");

    const tooth48 = getToothByFdi(48);
    expect(tooth48?.type).toBe("wisdom");
    expect(tooth48?.commonName).toContain("사랑니");
  });

  it("자연어 검색어 또는 #번호로 치아를 식별한다", () => {
    expect(matchToothFromQuery("#16")?.fdiNumber).toBe(16);
    expect(matchToothFromQuery("오른쪽 위 첫째 큰어금니")?.fdiNumber).toBe(16);
    expect(matchToothFromQuery("왼쪽 아래 대문니")?.fdiNumber).toBe(31);
    expect(matchToothFromQuery("상악 좌측 견치")?.fdiNumber).toBe(23);
  });
});
