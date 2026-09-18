import { describe, expect, it } from "vitest";
import {
  childOfficialMeshHint,
  compoundCoversKorean,
  parseSearchSide,
  queryWithoutSide,
} from "./anatomySearchQuery";
import { ANATOMY_COMPOUND_REGISTRY } from "./anatomyCompoundRegistry";

describe("anatomySearchQuery", () => {
  it("우측·좌측 검색어에서 방향을 읽고 장기명만 남긴다", () => {
    expect(parseSearchSide("우측 부신")).toBe("right");
    expect(parseSearchSide("좌측 부신")).toBe("left");
    expect(queryWithoutSide("우측 부신")).toBe("부신");
  });

  it("부신 좌우 자식 id를 공식 메쉬명 힌트로 바꾼다", () => {
    expect(childOfficialMeshHint("adrenal-glands-suprarenal-gland-right", "adrenal-glands")).toBe("suprarenal gland.r");
    expect(childOfficialMeshHint("testes-testis-left", "testes")).toBe("testis.l");
    expect(childOfficialMeshHint("testes-testis-right", "testes")).toBe("testis.r");
    expect(childOfficialMeshHint("kidneys-kidney-left", "kidneys")).toBe("kidney.l");
  });

  it("복합 장기 부신이 사전 한글명 부신을 덮는다", () => {
    expect(compoundCoversKorean(ANATOMY_COMPOUND_REGISTRY["adrenal-glands"], "부신")).toBe(true);
    expect(compoundCoversKorean(ANATOMY_COMPOUND_REGISTRY["rotator-cuff-muscles"], "극상근")).toBe(false);
  });
});
