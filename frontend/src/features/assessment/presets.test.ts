import { describe, expect, it } from "vitest";

import { FIELD_GROUPS, REQUIRED_FIELDS, outOfRangeFields, toRequestBody } from "./fields";
import { ASSESSMENT_PRESETS, presetValues } from "./presets";

const FORM_FIELDS = new Set(FIELD_GROUPS.flatMap((group) => group.fields.map((field) => field.name)));

describe("테스트 프로필", () => {
  it("프로필마다 필수 칸이 전부 채워진다 — 누르면 바로 판정할 수 있어야 한다", () => {
    for (const preset of ASSESSMENT_PRESETS) {
      const values = presetValues(preset);
      for (const name of REQUIRED_FIELDS) {
        expect(values[name], `${preset.key} 의 ${name}`).toBeTruthy();
      }
    }
  });

  /**
   * 데모(`app/apis/demo_routers.py`)는 규칙 엔진 이름을 썼다 — `total_cholesterol`·
   * `ldl_c`·`hdl_c`·`triglycerides`. 이 폼은 ML 이름을 쓴다. 옮길 때 넷을 바꿨는데,
   * **틀리면 조용히 무시된다** — 폼에 없는 id 는 `setValues` 가 받아도 그리는 칸이
   * 없고, 사용자는 "프로필을 눌렀는데 지질이 안 채워진다" 로만 본다.
   */
  it("프로필이 채우는 이름은 전부 폼에 있는 칸이다 — 유령 필드가 없다", () => {
    for (const preset of ASSESSMENT_PRESETS) {
      for (const name of Object.keys(presetValues(preset))) {
        expect(FORM_FIELDS.has(name), `${preset.key} 의 ${name} 이 폼에 없다`).toBe(true);
      }
    }
  });

  it("프로필 값이 DTO 범위를 넘지 않는다 — 넘으면 422 로 돌아온다", () => {
    for (const preset of ASSESSMENT_PRESETS) {
      expect(outOfRangeFields(presetValues(preset)), preset.key).toEqual({});
    }
  });

  it("검사값이 채워져 정밀형으로 채점된다", () => {
    for (const preset of ASSESSMENT_PRESETS) {
      const body = toRequestBody(presetValues(preset));
      // 라벨을 만드는 검사값이 그 질환에서 빠지는 것은 서버가 하는 일이다. 여기서는
      // 폼이 검사값을 실제로 실어 보내는지만 본다 — 하나라도 있으면 tier 가 lab 이다.
      expect(body.fasting_glucose ?? body.hemoglobin ?? body.creatinine, preset.key).toBeDefined();
    }
  });

  it("질환 프로필은 정상 프로필과 실제로 다른 값을 낸다", () => {
    const normal = presetValues(ASSESSMENT_PRESETS[0]);
    for (const preset of ASSESSMENT_PRESETS.slice(1)) {
      expect(presetValues(preset), preset.key).not.toEqual(normal);
    }
  });
});
