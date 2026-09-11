import { describe, expect, it } from "vitest";

import type { DiseaseVerdict } from "./contracts";
import type { ModelSpec } from "./Evidence";
import { briefList, objectParticle, precisionGains, sharedRefining } from "./precision";

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

/**
 * 여러 카드에 똑같이 걸린 값을 카드 위로 올리는 규칙.
 *
 * 카드마다 적던 때 "앉아 있는 시간을 넣으면 예측이 정밀해져요" 가 한 화면에 **14번**
 * 나왔다(2026-09-10 실측). 같은 한 칸을 채우면 그 카드들이 동시에 정밀해지므로
 * 정보는 하나뿐이고, 열네 번 반복되면 정보가 아니라 배경이 된다.
 */
describe("sharedRefining", () => {
  const values = { age: "54", sex: "M", bmi: "26", self_rated_health: "3" };

  /**
   * 카드 여러 장이 **같은 모델**을 본다. `precisionGains` 는 모델을
   * `reference.model_target` 으로 찾으므로, 카드 키가 달라도 이 값을 맞춰야 같은
   * refining 목록이 나온다 — 실제 화면도 그렇다(`liver` 카드는 `liver_enzyme_high`
   * 번들이 답한다).
   */
  function cards(count: number): DiseaseVerdict[] {
    return Array.from({ length: count }, (_, index) =>
      verdict({ key: `card${index}`, reference: { model_target: "dm", tier: "basic" } as never }),
    );
  }

  it("문턱 이상의 카드에 걸린 값만 올린다", () => {
    const shared = sharedRefining(cards(3), values, [DM_BASIC, DM_LAB], 3);

    expect(shared).toContain("중성지방");
    // 둘에만 걸린 값은 올리지 않는다 — 어느 카드 이야기인지 되짚게 된다.
    expect(sharedRefining(cards(2), values, [DM_BASIC, DM_LAB], 3)).toEqual([]);
  });

  it("이미 채운 값은 올리지 않는다", () => {
    const filled = { ...values, triglyceride: "180" };
    const shared = sharedRefining(cards(3), filled, [DM_BASIC, DM_LAB], 3);

    expect(shared).not.toContain("중성지방");
    // 다른 안 채운 값은 그대로 남는다 — 필터가 통째로 비우는 것이 아니다.
    expect(shared.length).toBeGreaterThan(0);
  });

  it("카드가 없으면 아무것도 올리지 않는다", () => {
    expect(sharedRefining([], values, [DM_BASIC, DM_LAB])).toEqual([]);
  });
});
