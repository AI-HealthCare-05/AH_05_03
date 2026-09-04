/**
 * 질환 판정 → 3D 인체에서 칠할 부위.
 *
 * ## 왜 계통이 아니라 장기인가
 *
 * 메시는 `userData.anatomySystem` 으로 계통을 들고 있어서 `cardiovascular` 를 통째로
 * 칠하는 것이 제일 쉽다. 그런데 이 모델의 심혈관 69개는 **심장과 폐혈관**이다 —
 * 대동맥도, 관상동맥 바깥의 전신동맥도 없다. 이상지질혈증으로 계통을 칠하면 죽상
 * 경화가 실제로 일어나는 곳이 아니라 **폐동맥이 빨개진다.** 틀린 그림이다.
 *
 * 그래서 위험이 실리는 장기를 이름으로 집는다. 없는 것은 칠하지 않는다.
 *
 * ## 무엇을 안 칠하는가
 *
 * - **빈혈** — 혈액은 이 모델에 계통이 없다. 골수(skeletal)를 칠하면 뼈가 아픈 것으로
 *   읽힌다.
 * - **비만** — 특정 장기의 문제가 아니다. 전신을 칠하면 아무것도 말하지 않는 것과 같다.
 *
 * 안 칠하는 것을 목록에 남겨 두는 이유는, 다음 사람이 "빠뜨렸나" 를 확인하러 코드를
 * 다시 읽지 않게 하려는 것이다.
 */

/** 판정 등급. 규칙 엔진 5단계와 같다. */
export type BodyRiskLevel = "VERY_HIGH" | "HIGH" | "CAUTION" | "NORMAL";

export interface BodyRegion {
  /** 화면에 쓰는 이름 */
  label: string;
  /** 메타데이터의 구조 이름. 소문자로 비교한다 — 모델이 `liver`·`Heart` 를 섞어 쓴다. */
  structures: string[];
  /** 이 부위를 고른 이유. 카드에 그대로 나간다. */
  why: string;
}

export const BODY_REGIONS: Record<string, BodyRegion> = {
  heart: {
    label: "심장",
    structures: ["heart", "left atrium", "left ventricle", "right atrium", "right ventricle", "cardiac internal structures"],
    why: "압력과 지질 부담이 실리는 곳",
  },
  kidneys: {
    label: "콩팥",
    structures: ["kidneys", "kidney.l", "kidney.r"],
    why: "여과 기능이 떨어지는 곳",
  },
  liver: {
    label: "간",
    structures: ["liver", "gallbladder"],
    why: "지방이 쌓이고 효소가 올라가는 곳",
  },
  pancreas: {
    label: "췌장",
    structures: ["pancreas"],
    why: "인슐린을 내는 곳",
  },
};

/**
 * 질환 키 → 부위. 한 질환이 여러 장기에 걸릴 수 있다(대사증후군).
 *
 * 키는 서버 판정의 `key` 와 매트릭스 축의 이름을 함께 받는다 — 화면이 둘을 같이
 * 들고 있고, 어느 쪽에서 왔든 같은 곳을 칠해야 한다.
 */
export const DISEASE_REGIONS: Record<string, string[]> = {
  htn: ["heart"],
  cvd_risk: ["heart"],
  dlp: ["heart"],
  hyperchol: ["heart"],
  hypertg: ["heart"],
  low_hdl: ["heart"],
  dm: ["pancreas"],
  mets: ["pancreas", "liver", "heart"],
  ckd: ["kidneys"],
  kidney: ["kidneys"],
  uric_acid: ["kidneys"],
  fatty_liver: ["liver"],
  liver: ["liver"],
};

/** 칠하지 않는 질환과 그 이유. 코드가 읽지는 않는다 — 사람이 읽는다. */
export const UNMAPPED: Record<string, string> = {
  anemia: "혈액은 이 모델에 계통이 없다. 골수를 칠하면 뼈 문제로 읽힌다",
  obesity: "특정 장기의 문제가 아니다. 전신을 칠하면 아무 말도 안 하는 것과 같다",
};

const SEVERITY: Record<BodyRiskLevel, number> = { NORMAL: 0, CAUTION: 1, HIGH: 2, VERY_HIGH: 3 };

/** 부위 색. 판정 카드의 등급 색과 같은 값을 쓴다 — 두 화면이 다른 빨강을 쓰면 안 된다. */
export const REGION_COLOR: Record<BodyRiskLevel, number> = {
  NORMAL: 0x15936e,
  CAUTION: 0xd98324,
  HIGH: 0xb43e47,
  VERY_HIGH: 0x8c2c34,
};

export interface RegionRisk {
  region: string;
  label: string;
  level: BodyRiskLevel;
  why: string;
  /** 이 부위를 끌어올린 질환들. 가장 높은 등급부터. */
  diseases: { key: string; name: string; level: BodyRiskLevel }[];
}

/**
 * 판정 한 벌 → 부위별 위험.
 *
 * 한 부위에 질환이 여럿 걸리면 **가장 높은 등급**을 쓴다. 평균을 내면 심장에 고혈압
 * `VERY_HIGH` 와 낮은 HDL `NORMAL` 이 걸렸을 때 `HIGH` 로 내려가는데, 그건 사용자가
 * 알아야 할 것을 깎는 것이다.
 */
export function regionRisks(
  verdicts: { key: string; name?: string; risk_level: string }[],
): RegionRisk[] {
  const buckets = new Map<string, RegionRisk>();

  for (const verdict of verdicts) {
    const level = verdict.risk_level as BodyRiskLevel;
    if (!(level in SEVERITY)) continue; // INSUFFICIENT_DATA 는 칠하지 않는다
    for (const region of DISEASE_REGIONS[verdict.key] ?? []) {
      const spec = BODY_REGIONS[region];
      if (!spec) continue;
      const found = buckets.get(region);
      const entry = { key: verdict.key, name: verdict.name ?? verdict.key, level };
      if (!found) {
        buckets.set(region, { region, label: spec.label, level, why: spec.why, diseases: [entry] });
        continue;
      }
      found.diseases.push(entry);
      if (SEVERITY[level] > SEVERITY[found.level]) found.level = level;
    }
  }

  for (const risk of buckets.values()) {
    risk.diseases.sort((a, b) => SEVERITY[b.level] - SEVERITY[a.level]);
  }
  return [...buckets.values()].sort((a, b) => SEVERITY[b.level] - SEVERITY[a.level]);
}

/** 구조 이름 → 부위 키. 3D 쪽이 메시마다 물어본다. */
export function regionOfStructure(name: string): string | undefined {
  const needle = name.toLowerCase();
  for (const [key, spec] of Object.entries(BODY_REGIONS)) {
    if (spec.structures.some((structure) => needle === structure || needle.startsWith(`${structure}.`))) {
      return key;
    }
  }
  return undefined;
}
