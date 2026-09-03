/**
 * 질환 → 부위 매핑 계약.
 *
 * 이 표가 조용히 틀리면 **엉뚱한 장기가 빨개진다.** 화면은 아무 오류도 내지 않고,
 * 사용자는 자기 콩팥이 나쁘다고 읽는다. 그래서 매핑 자체를 고정한다.
 */

import { describe, expect, it } from "vitest";

import { BODY_REGIONS, DISEASE_REGIONS, UNMAPPED, regionOfStructure, regionRisks } from "./bodyRisk";

describe("질환 → 부위", () => {
  it("가리키는 부위가 전부 실재한다", () => {
    for (const [disease, regions] of Object.entries(DISEASE_REGIONS)) {
      for (const region of regions) {
        expect(BODY_REGIONS[region], `${disease} 가 없는 부위 ${region} 를 가리킨다`).toBeDefined();
      }
    }
  });

  it("칠하는 질환과 안 칠하는 질환이 겹치지 않는다", () => {
    for (const key of Object.keys(UNMAPPED)) {
      expect(DISEASE_REGIONS[key], `${key} 는 안 칠하기로 했는데 매핑이 있다`).toBeUndefined();
    }
  });

  it("고혈압은 심장, 만성콩팥병은 콩팥, 지방간은 간이다", () => {
    expect(DISEASE_REGIONS.htn).toEqual(["heart"]);
    expect(DISEASE_REGIONS.ckd).toEqual(["kidneys"]);
    expect(DISEASE_REGIONS.fatty_liver).toEqual(["liver"]);
    expect(DISEASE_REGIONS.dm).toEqual(["pancreas"]);
  });
});

describe("구조 이름 → 부위", () => {
  it("모델이 쓰는 실제 이름을 잡는다", () => {
    // 모델은 대소문자를 섞어 쓴다 — `Heart` 와 `liver` 가 한 파일에 있다.
    expect(regionOfStructure("Heart")).toBe("heart");
    expect(regionOfStructure("liver")).toBe("liver");
    expect(regionOfStructure("Kidneys")).toBe("kidneys");
    expect(regionOfStructure("pancreas")).toBe("pancreas");
  });

  it("좌우가 갈린 구조도 같은 부위로 본다", () => {
    expect(regionOfStructure("Kidney.l")).toBe("kidneys");
    expect(regionOfStructure("Kidney.r")).toBe("kidneys");
  });

  it("이름이 겹쳐 보이는 것을 잘못 잡지 않는다", () => {
    // 관련 없는 구조가 부위로 잡히면 그 장기가 이유 없이 색을 얻는다.
    expect(regionOfStructure("Superior pancreatic nodes")).toBeUndefined();
    expect(regionOfStructure("Pulmonary Arteries")).toBeUndefined();
    expect(regionOfStructure("Adrenal Glands")).toBeUndefined();
  });
});

describe("부위별 위험", () => {
  it("한 부위에 여럿이 걸리면 가장 높은 등급을 쓴다", () => {
    // 평균을 내면 매우 높음과 정상이 섞여 높음으로 내려간다 — 알아야 할 것을 깎는다.
    const risks = regionRisks([
      { key: "htn", name: "고혈압", risk_level: "VERY_HIGH" },
      { key: "low_hdl", name: "낮은 HDL", risk_level: "NORMAL" },
    ]);
    expect(risks).toHaveLength(1);
    expect(risks[0].region).toBe("heart");
    expect(risks[0].level).toBe("VERY_HIGH");
    // 색을 만든 질환을 전부 남긴다. 화면이 "심장이 왜 빨간가" 에 답해야 한다.
    expect(risks[0].diseases.map((d) => d.name)).toEqual(["고혈압", "낮은 HDL"]);
  });

  it("정보 부족은 칠하지 않는다", () => {
    expect(regionRisks([{ key: "ckd", risk_level: "INSUFFICIENT_DATA" }])).toEqual([]);
  });

  it("대사증후군은 세 곳에 걸린다", () => {
    const risks = regionRisks([{ key: "mets", name: "대사증후군", risk_level: "HIGH" }]);
    expect(risks.map((r) => r.region).sort()).toEqual(["heart", "liver", "pancreas"]);
  });

  it("높은 등급이 앞에 온다", () => {
    const risks = regionRisks([
      { key: "fatty_liver", name: "지방간", risk_level: "CAUTION" },
      { key: "ckd", name: "만성콩팥병", risk_level: "VERY_HIGH" },
    ]);
    expect(risks.map((r) => r.level)).toEqual(["VERY_HIGH", "CAUTION"]);
  });

  it("매핑이 없는 질환은 아무 부위도 만들지 않는다", () => {
    expect(regionRisks([{ key: "anemia", name: "빈혈", risk_level: "HIGH" }])).toEqual([]);
  });
});
