/**
 * "이 질환에 무엇을 더 넣으면 좋아지나" — 질환마다 다른 답을 낸다.
 *
 * ## 왜 필요했나
 *
 * 카드에는 `missing_fields` 한 줄만 있었다. 그 값은 **규칙 엔진**이 단계를 못 정할
 * 때만 채워지므로, 이미 판정이 난 질환에는 아무것도 안 뜬다. 그런데 판정이 났다고
 * 더 넣을 게 없는 것이 아니다 — ML 쪽은 그 질환의 정밀형(`lab`) 번들이 스무 개
 * 가까운 검사값을 받고, 그중 안 넣은 것이 있으면 확률이 그만큼 거칠다.
 *
 * 실측으로 보면 차이가 크다. 당뇨 카드는 규칙 엔진이 `ogtt_2h` 하나를 물었지만,
 * `dm_lab` 번들은 지질 넉 장·간효소 셋·요산·크레아티닌·혈색소까지 받는다. 화면은
 * 그 사실을 한 글자도 말하지 않았다.
 *
 * ## 두 줄을 가르는 이유
 *
 *   판정  이 값이 없으면 **규칙 엔진이 단계를 못 정한다**. 넣으면 등급이 바뀔 수 있다.
 *   예측  이 값이 없어도 등급은 난다. 넣으면 **ML 확률이 정밀해진다**.
 *
 * 둘을 한 줄에 섞으면 "넣으면 등급이 바뀌나?" 를 사용자가 구분할 수 없다.
 *
 * ## 라벨 검사값은 여기 안 나온다
 *
 * 그 질환의 라벨을 만드는 검사값은 학습에서 차단된다(`modeling/targets.py`). 그래서
 * 고혈압 정밀형 번들에는 `sbp`·`dbp` 가 아예 없고, 여기 목록에도 안 뜬다 —
 * 번들의 `required_inputs`·`optional_inputs` 를 그대로 읽기 때문이다. 화면이 따로
 * 판단하지 않는 것이 중요하다. 두 곳에서 판단하면 한쪽만 고쳐진다.
 */

import type { DiseaseVerdict } from "./contracts";
import type { ModelSpec } from "./Evidence";
import { FIELD_GROUPS, FIELD_LABELS, readableField } from "./fields";

/** 폼에 인쇄된 순서. 검진결과지 순서와 비슷해서 위에서 아래로 옮겨 적을 수 있다. */
const FORM_ORDER: string[] = FIELD_GROUPS.flatMap((group) => group.fields.map((field) => field.name));

/**
 * 모델은 이름으로 받지만 폼에는 그 칸이 없는 값 — 다른 칸에서 계산된다.
 *
 * 이걸 그대로 "넣으세요" 라고 적으면 사용자는 존재하지 않는 칸을 찾는다. 실제로
 * 채워야 하는 칸으로 바꿔서 말한다.
 */
const DERIVED_FROM: Record<string, string[]> = {
  bmi: ["height_cm", "weight_kg"],
  egfr: ["creatinine"],
};

/** 필수라 이미 채워져 있고, "더 넣을 값" 으로 셀 것이 아닌 칸. */
const ALWAYS_PRESENT = new Set(["age", "sex", "self_rated_health"]);

export interface PrecisionGain {
  /** 규칙 엔진이 단계를 확정하려면 있어야 하는 값. */
  decisive: string[];
  /** ML 정밀형 번들이 쓰는 입력 중 아직 안 넣은 것. */
  refining: string[];
  /** 지금 일반형(`basic`)으로 채점됐고, 검사값을 넣으면 정밀형으로 올라가나. */
  tierUp: boolean;
  /** 이 질환에 ML 번들 자체가 없나(비만·간기능·요산). */
  noModel: boolean;
}

/** 폼 이름으로 풀어 낸다 — 파생값은 그 재료 칸으로, 이미 넣은 칸은 뺀다. */
function unfilled(name: string, values: Record<string, string>): string[] {
  const sources = DERIVED_FROM[name] ?? [name];
  return sources.filter((source) => !values[source]);
}

export function precisionGains(
  verdict: DiseaseVerdict,
  values: Record<string, string>,
  models: ModelSpec[],
): PrecisionGain {
  const decisiveNames = verdict.missing_fields.flatMap((name) => unfilled(name, values));
  const decisive = [...new Set(decisiveNames)];

  const target = verdict.reference?.model_target ?? verdict.key;
  const lab = models.find((model) => model.target === target && model.tier === "lab");
  const wanted = lab ? [...lab.required_inputs, ...lab.optional_inputs] : [];
  const refining = [...new Set(wanted.filter((name) => !ALWAYS_PRESENT.has(name)).flatMap((name) => unfilled(name, values)))]
    .filter((name) => !decisive.includes(name))
    .sort((a, b) => {
      const ai = FORM_ORDER.indexOf(a);
      const bi = FORM_ORDER.indexOf(b);
      return (ai < 0 ? FORM_ORDER.length : ai) - (bi < 0 ? FORM_ORDER.length : bi);
    });

  return {
    decisive: decisive.map(readableField),
    refining: refining.map((name) => FIELD_LABELS[name] ?? readableField(name)),
    tierUp: Boolean(lab) && verdict.reference?.tier !== "lab",
    noModel: models.length > 0 && !lab,
  };
}

/**
 * 목적격 조사 — 받침이 있으면 `을`, 없으면 `를`.
 *
 * 붙박이로 `를` 만 쓰던 때 화면에 `경구당부하 2시간를 넣으면` 이 떴다. 검진 항목
 * 이름은 절반쯤이 받침으로 끝나서(혈색소·요산·크레아티닌) 한쪽으로 고정할 수 없다.
 */
const DIGIT_HAS_FINAL = [true, true, false, true, false, false, true, true, true, false];

export function objectParticle(word: string): "을" | "를" {
  const last = word.trim().slice(-1);
  if (!last) return "를";
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? "를" : "을";
  if (last >= "0" && last <= "9") return DIGIT_HAS_FINAL[Number(last)] ? "을" : "를";
  return "를";
}

/** `가, 나, 다 외 4개` — 목록이 길면 카드가 세 줄이 된다. 앞 셋만 적는다. */
export function briefList(items: string[], limit = 3): string {
  if (items.length <= limit) return items.join(", ");
  return `${items.slice(0, limit).join(", ")} 외 ${items.length - limit}개`;
}

/**
 * 여러 카드에 **똑같이** 걸리는 정밀화 입력을 골라낸다.
 *
 * 카드마다 `refining` 을 적으면 같은 문장이 그대로 반복된다 — 2026-09-10 실측으로
 * "앉아 있는 시간을 넣으면 예측이 정밀해져요" 가 한 화면에 **14번** 나왔다. 같은
 * 한 칸을 채우면 그 카드들이 동시에 정밀해지는 것이므로, 정보는 "여러 카드가 이
 * 값을 기다린다" 하나뿐이고 자리도 하나여야 한다.
 *
 * `threshold` 이상의 카드에 걸린 항목만 올린다. 둘에만 걸린 값을 위로 올리면
 * 사용자가 어느 카드 이야기인지 되짚어야 해서, 카드에 그대로 두는 편이 낫다.
 */
export function sharedRefining(
  verdicts: DiseaseVerdict[],
  values: Record<string, string>,
  models: ModelSpec[],
  threshold = 3,
): string[] {
  const counts = new Map<string, number>();
  for (const verdict of verdicts) {
    for (const label of new Set(precisionGains(verdict, values, models).refining)) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);
}
