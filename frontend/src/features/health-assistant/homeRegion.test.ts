import { afterEach, describe, expect, it } from "vitest";

import {
  ALLOW_GPS_CHIP,
  AREA_VIEW_SUFFIX,
  areaViewChip,
  isLocationChoiceChip,
  parseAreaViewChip,
  PICK_OTHER_REGION_CHIP,
  readHomeRegion,
  writeHomeRegion,
} from "./homeRegion";

describe("homeRegion", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("생활권 칩 문구를 만들고 되돌린다", () => {
    expect(areaViewChip("하남시")).toBe("하남시 기준으로 보기");
    expect(parseAreaViewChip("하남시 기준으로 보기")).toBe("하남시");
    expect(parseAreaViewChip("서울 날씨")).toBeNull();
  });

  it("프로필별로 생활권을 기억한다", () => {
    writeHomeRegion("p1", "하남시");
    expect(readHomeRegion("p1")).toBe("하남시");
    expect(readHomeRegion("p2")).toBeNull();
  });

  it("위치 선택 칩만 가로챈다", () => {
    expect(isLocationChoiceChip(ALLOW_GPS_CHIP)).toBe(true);
    expect(isLocationChoiceChip(PICK_OTHER_REGION_CHIP)).toBe(true);
    expect(isLocationChoiceChip(`하남시${AREA_VIEW_SUFFIX}`)).toBe(true);
    expect(isLocationChoiceChip("네, 저장해 주세요")).toBe(false);
  });
});
