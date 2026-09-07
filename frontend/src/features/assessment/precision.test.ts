import { describe, expect, it } from "vitest";

import type { DiseaseVerdict } from "./contracts";
import type { ModelSpec } from "./Evidence";
import { briefList, objectParticle, precisionGains } from "./precision";

function verdict(patch: Partial<DiseaseVerdict> = {}): DiseaseVerdict {
  return {
    key: "dm",
    name: "당뇨병",
    engine: "E1",
    engine_label: "규칙 엔진",
    engine_reason: "측정값이 있어 규칙 엔진이 정본입니다.",
    risk_level: "VERY_HIGH",
    sub_status: "당뇨병",
    display_label: "",
    reason: "",
    criteria_reference: "",
    recommendation: "",
    missing_fields: [],
    flags: [],
    superseded_by: "E1",
    reference: null,
    disclaimer: "",
    ...patch,
  };
}

/** 실제 `dm_lab` 번들의 입력 목록을 줄인 것. 라벨 검사값(공복혈당·당화혈색소)이 없다. */
const DM_LAB: ModelSpec = {
  target: "dm",
  tier: "lab",
  required_inputs: ["age", "sex", "bmi", "self_rated_health"],
  optional_inputs: ["waist_cm", "total_chol", "hdl", "ldl", "triglyceride", "ast", "alt", "creatinine", "egfr"],
};
const DM_BASIC: ModelSpec = {
  target: "dm",
  tier: "basic",
  required_inputs: ["age", "sex", "bmi", "self_rated_health"],
  optional_inputs: ["waist_cm"],
};

describe("precisionGains", () => {
  it("규칙 엔진이 못 본 값과 ML 이 못 본 값을 따로 센다", () => {
    const gain = precisionGains(
      verdict({ missing_fields: ["ogtt_2h"], reference: { tier: "lab" } as never }),
      { age: "54", sex: "M", height_cm: "173", weight_kg: "78", self_rated_health: "3", total_chol: "210" },
      [DM_BASIC, DM_LAB],
    );

    // 등급을 바꿀 수 있는 쪽. 내부 이름이 아니라 폼 라벨로 나온다.
    expect(gain.decisive).toEqual(["경구당부하 2시간"]);
    // 이미 넣은 총콜레스테롤은 빠지고, 안 넣은 것만 남는다.
    expect(gain.refining).not.toContain("총콜레스테롤");
    expect(gain.refining).toContain("중성지방");
    // 나이·성별·주관적 건강은 필수라 "더 넣을 값" 이 아니다.
    expect(gain.refining).not.toContain("나이");
    expect(gain.tierUp).toBe(false);
  });

  it("파생값은 실제로 채워야 하는 칸으로 바꿔 말한다", () => {
    // `bmi` 는 폼에 칸이 없다. 그대로 적으면 사용자가 없는 칸을 찾는다.
    const gain = precisionGains(verdict(), { age: "54", sex: "M", self_rated_health: "3" }, [DM_LAB]);
    expect(gain.refining).toContain("키");
    expect(gain.refining).toContain("체중");
    expect(gain.refining).not.toContain("bmi");
    // `egfr` 도 마찬가지 — 크레아티닌에서 계산된다.
    expect(gain.refining).not.toContain("egfr");
    expect(gain.refining).toContain("크레아티닌");
  });

  it("일반형으로 채점됐으면 정밀형으로 올라갈 수 있다고 알린다", () => {
    const gain = precisionGains(verdict({ reference: { tier: "basic" } as never }), { age: "54" }, [DM_BASIC, DM_LAB]);
    expect(gain.tierUp).toBe(true);
  });

  it("ML 번들이 없는 질환은 그 사실을 구분해 돌려준다", () => {
    // 비만·간기능·요산에는 번들이 없다. "전부 들어왔다" 와 같은 말로 뭉치면
    // 사용자는 모델이 있는 줄 안다.
    const gain = precisionGains(verdict({ key: "obesity" }), { age: "54" }, [DM_BASIC, DM_LAB]);
    expect(gain.noModel).toBe(true);
    expect(gain.refining).toEqual([]);
  });

  it("모델 목록을 못 받았으면 없다고 말하지 않는다", () => {
    const gain = precisionGains(verdict({ key: "obesity" }), { age: "54" }, []);
    expect(gain.noModel).toBe(false);
  });
});

describe("objectParticle", () => {
  it("받침 유무로 을·를을 가른다", () => {
    // 붙박이로 `를` 만 쓰던 때 화면에 `경구당부하 2시간를 넣으면` 이 떴다.
    expect(objectParticle("경구당부하 2시간")).toBe("을");
    expect(objectParticle("혈색소")).toBe("를");
    expect(objectParticle("요산")).toBe("을");
    expect(objectParticle("중성지방")).toBe("을");
    expect(objectParticle("키, 체중 외 4개")).toBe("를");
  });
});

describe("briefList", () => {
  it("셋을 넘으면 나머지는 개수로 접는다", () => {
    expect(briefList(["가", "나"])).toBe("가, 나");
    expect(briefList(["가", "나", "다", "라", "마"])).toBe("가, 나, 다 외 2개");
  });
});
