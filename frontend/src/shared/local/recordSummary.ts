/**
 * 건강기록 하나가 **무슨 수치를 담고 있는가**, 그리고 그것을 한 줄로 어떻게 말하는가.
 *
 * ## 왜 이 파일이 생겼나
 *
 * 화면마다 payload 를 따로 읽고 서로 **다르게** 말하고 있었다(2026-09-10 실측).
 *
 *     가족 홈 최근 기록      "저장된 건강기록"   ← 수치를 아예 안 읽는다
 *     건강기록 작성 목록      "혈압 128/82 mmHg"
 *     건강 데이터 추이        수치만 뽑아 그래프로
 *     봄이 대화 컨텍스트      또 다른 문장으로
 *
 * 같은 기록이 화면마다 다르게 보이면 사용자는 어느 쪽이 자기 기록인지 알 수 없다.
 * 그래서 **읽는 방법을 여기 한 곳에** 둔다(AGENTS.md §2-5).
 *
 * ## 요약을 `note` 로 만들지 않는다
 *
 * 옮겨 온 옛 요약기의 첫 분기가 `payload.note` 였다 — 메모가 있으면 그것을 그대로
 * 돌려줬다. 그래서 봄이 대화로 저장한 혈압 기록은 목록에서 `혈압 128/82` 가 아니라
 * 메모 문장으로 보였고, **같은 값의 기록 둘이 서로 다르게 읽혔다.**
 *
 * 지금은 수치에서 요약을 만들고 `note` 는 수치가 하나도 없을 때만 쓴다.
 *
 * ## 필드 이름이 여러 개인 것을 여기서 흡수한다
 *
 * writer 마다 이름이 달랐다(`systolic` vs `systolicMmHg`, `value` vs `valueMgDl`).
 * 2026-09-10 에 단위 붙은 쪽으로 통일했지만 그전 기록이 남으므로 별칭을 읽는다.
 * 서버의 `app/services/record_prefill.py` 가 같은 승계를 하고, 그쪽은 **판정 입력**을
 * 만든다 — 이 파일은 **화면 표시**를 만든다. 목적이 달라 둘로 두지만, 별칭 목록이
 * 갈리면 한쪽에서만 보이는 값이 생기므로 고칠 때 같이 본다.
 */

import type { HealthRecord, HealthRecordType } from "./domainContracts";

/** 기록이 담은 수치 하나. `field` 는 판정 폼 칸 이름이 있을 때만 붙는다. */
export interface RecordValue {
  label: string;
  value: number | string;
  unit?: string;
  /** 판정 폼 입력 이름. 추이 그래프와 판정 채우기가 이 값으로 묶는다. */
  field?: string;
}

function num(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function str(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

/** 옛 이름과 지금 이름을 함께 본다. 앞의 것이 먼저 이긴다. */
function pick(payload: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = num(payload[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

const TIMING_LABEL: Record<string, string> = {
  fasting: "공복",
  before_meal: "식전",
  after_meal: "식후",
  bedtime: "취침 전",
  random: "무작위",
};

/**
 * 기록이 담은 수치들. **비어 있을 수 있다** — 복약·메모처럼 수치가 없는 종류가 있다.
 *
 * 챌린지 측정(`payload.values`)은 키가 이미 판정 폼 칸 이름이라 그대로 쓴다.
 * 세 writer 중 처음부터 정본 모양이었던 쪽이고, 나머지를 그 모양으로 모았다.
 */
export function recordValues(record: HealthRecord): RecordValue[] {
  const p = record.payload as Record<string, unknown>;
  const out: RecordValue[] = [];

  const values = p.values;
  if (values && typeof values === "object") {
    for (const [field, raw] of Object.entries(values as Record<string, unknown>)) {
      const value = num(raw);
      if (value !== undefined) out.push({ label: FIELD_LABEL[field] ?? field, value, unit: FIELD_UNIT[field], field });
    }
  }
  /**
   * 정본 맵이 있으면 **읽은 행은 값으로 세지 않는다.**
   *
   * 검진표는 두 겹으로 담긴다 — OCR 이 읽은 행(`items`)과 판정 칸 이름으로 정리한
   * 맵(`values`). 둘을 다 세면 공복혈당 하나가 두 번 서고, 추이 그래프에서는 같은
   * 날 같은 점이 두 개 찍힌다.
   *
   * 서버 `record_prefill.fields_for` 도 같은 순서로 쌓는다(정본이 이긴다).
   */
  const hasCanonical = out.length > 0;

  const sbp = pick(p, ["systolicMmHg", "systolic"]);
  const dbp = pick(p, ["diastolicMmHg", "diastolic"]);
  if (sbp !== undefined) out.push({ label: "수축기", value: sbp, unit: "mmHg", field: "sbp" });
  if (dbp !== undefined) out.push({ label: "이완기", value: dbp, unit: "mmHg", field: "dbp" });
  const pulse = pick(p, ["pulseBpm", "pulse"]);
  if (pulse !== undefined) out.push({ label: "맥박", value: pulse, unit: "bpm" });

  const glucose = pick(p, ["valueMgDl", "glucose", record.recordType === "blood_glucose" ? "value" : ""]);
  if (glucose !== undefined) {
    const timing = str(p.timing);
    out.push({
      label: timing ? `${TIMING_LABEL[timing] ?? timing} 혈당` : "혈당",
      value: glucose,
      unit: "mg/dL",
      // **공복이라고 적힌 것만** 판정 칸에 잇는다. 식후 값을 공복혈당으로 쓰면
      // 정상인도 당뇨로 판정된다(서버 `record_prefill` 과 같은 규칙).
      field: timing === "fasting" || timing === "공복" ? "fasting_glucose" : undefined,
    });
  }

  const weight = num(p.weightKg);
  const height = num(p.heightCm);
  const waist = num(p.waistCm);
  // 운동 기록의 `weightKg` 은 **든 무게**다. 체중과 같은 이름을 쓰고 있어서
  // 종류를 안 보면 역기 무게가 체중 추이에 들어간다.
  if (weight !== undefined && record.recordType !== "exercise") {
    out.push({ label: "체중", value: weight, unit: "kg", field: "weight_kg" });
  }
  if (height !== undefined) out.push({ label: "키", value: height, unit: "cm", field: "height_cm" });
  if (waist !== undefined) out.push({ label: "허리둘레", value: waist, unit: "cm", field: "waist_cm" });

  const hours = pick(p, ["sleepHours", "hours"]);
  if (hours !== undefined) out.push({ label: "수면", value: hours, unit: "시간", field: "sleep_hours" });

  const intensity = num(p.intensity);
  if (intensity !== undefined) out.push({ label: "통증 강도", value: intensity, unit: "점" });

  // 검사 결과 한 줄, 그리고 검진표가 여러 줄로 담은 것. 위 정본 맵이 있으면 건너뛴다.
  const testName = hasCanonical ? "" : str(p.testName);
  if (testName) out.push({ label: testName, value: num(p.value) ?? str(p.value) ?? "", unit: str(p.unit) });
  if (!hasCanonical && Array.isArray(p.items)) {
    for (const item of p.items) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const name = str(row.testName);
      if (name) out.push({ label: name, value: num(row.value) ?? str(row.value) ?? "", unit: str(row.unit) });
    }
  }

  return out;
}

/** 챌린지 측정과 판정 입력이 쓰는 칸 이름의 한글 라벨. 화면 라벨은 여기 한 곳. */
const FIELD_LABEL: Record<string, string> = {
  sbp: "수축기",
  dbp: "이완기",
  fasting_glucose: "공복혈당",
  hba1c: "당화혈색소",
  total_chol: "총콜레스테롤",
  ldl: "LDL",
  hdl: "HDL",
  triglyceride: "중성지방",
  weight_kg: "체중",
  waist_cm: "허리둘레",
  height_cm: "키",
  sleep_hours: "수면",
};

const FIELD_UNIT: Record<string, string> = {
  sbp: "mmHg",
  dbp: "mmHg",
  fasting_glucose: "mg/dL",
  hba1c: "%",
  total_chol: "mg/dL",
  ldl: "mg/dL",
  hdl: "mg/dL",
  triglyceride: "mg/dL",
  weight_kg: "kg",
  waist_cm: "cm",
  height_cm: "cm",
  sleep_hours: "시간",
};

const TYPE_LABEL: Partial<Record<HealthRecordType, string>> = {
  blood_pressure: "혈압",
  blood_glucose: "혈당",
  body_measurement: "체성분",
  lab_result: "검사 결과",
  health_screening: "건강검진",
  pain: "통증",
  walking: "걷기",
  exercise: "운동",
  medication: "복약",
  sleep: "수면",
  daily_condition: "컨디션",
  vaccination: "예방접종",
  assessment: "위험 판정",
  note: "메모",
};

/** 기록 종류의 한글 이름. 화면마다 따로 적지 않는다. */
export function recordTypeLabel(type: HealthRecordType): string {
  return TYPE_LABEL[type] ?? "건강기록";
}

/**
 * 기록 한 줄 요약. **수치가 있으면 수치로 말한다.**
 *
 * 수치가 없는 종류(복약·예방접종·메모)만 이름과 `note` 를 쓴다. 순서를 뒤집으면
 * 메모를 적은 혈압 기록과 안 적은 혈압 기록이 목록에서 다르게 읽힌다.
 */
export function recordSummary(record: HealthRecord): string {
  const p = record.payload as Record<string, unknown>;
  const values = recordValues(record);

  if (values.length > 0) {
    // 혈압은 `128/82` 로 붙여 읽는 것이 관용이다. 두 줄로 쪼개면 낯설다.
    const sbp = values.find((v) => v.field === "sbp");
    const dbp = values.find((v) => v.field === "dbp");
    if (sbp && dbp) {
      const rest = values.filter((v) => v.field !== "sbp" && v.field !== "dbp");
      const tail = rest.map((v) => `${v.label} ${v.value}${v.unit ? v.unit : ""}`);
      return [`혈압 ${sbp.value}/${dbp.value} mmHg`, ...tail].join(" · ");
    }
    return values
      .slice(0, 3)
      .map((v) => `${v.label} ${v.value}${v.unit ? v.unit : ""}`)
      .join(" · ");
  }

  const name = str(p.medicationName) ?? str(p.vaccineName) ?? str(p.exerciseName) ?? str(p.screeningName);
  const note = str(p.note) ?? str(p.summary) ?? str(p.text);
  if (name && note) return `${name} · ${note}`.slice(0, 120);
  if (name) return name;
  if (note) return note.slice(0, 120);
  return recordTypeLabel(record.recordType);
}
