/**
 * 판정 시점 스냅샷 — 추적 대시보드의 재료.
 *
 * 왜 서버가 아니라 로컬인가
 * -------------------------
 * 서버는 판정을 저장하지 않는다(NFR-01, ADR-002). 그래서 "같은 사람의 다른 시점"을
 * 이으려면 남길 자리가 암호화 로컬 보관함뿐이다. 이미 있는 `HealthRecord` 배선을
 * 그대로 쓰고 `recordType` 만 `"assessment"` 로 더했다 — 새 저장소를 만들면 백업·
 * 복구·접근범위·프로필 병합을 전부 다시 구현해야 한다.
 *
 * 왜 등급까지 남기는가
 * --------------------
 * 입력값만 남기고 나중에 재채점하면 편할 것 같지만 **그날 사용자가 본 화면과 다른
 * 그래프가 그려진다.** 번들은 재학습으로 갱신되고 규칙 임계값도 지침 개정으로 바뀐다.
 * 추적은 그날 본 것을 이어야 뜻이 있다.
 */

import { PRIMARY_HOUSEHOLD_ID } from "../../app/localDomainContext";
import type {
  AssessmentSnapshotPayload,
  HealthRecord,
  StoredRisk,
  StoredVerdict,
} from "../../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
import type { AssessmentSummaryData, DiseaseRisk, DiseaseVerdict } from "./contracts";
import { toRequestBody } from "./fields";

export type Snapshot = HealthRecord<AssessmentSnapshotPayload>;

/**
 * 차트가 한 번에 그리는 시점 수.
 *
 * 스냅샷은 사용자가 누를 때마다 쌓이고 상한이 없다. 280px 폭에 점을 다 찍으면
 * 50개에서 간격이 5.4px, 120개에서 2.2px 가 되어 **선은 남고 점은 사라진다.**
 * 12개면 24px 간격으로 읽히고, 검진을 반년에 한 번 받는다면 6년 치다.
 *
 * 잘라 낸 것은 지우지 않는다 — 보관함에는 다 남아 있고 화면만 최근 창을 본다.
 */
export const TREND_WINDOW = 12;

/** 시계열로 그릴 수치. 검진결과지에서 반복 측정되는 것만 골랐다. */
export const TREND_SERIES: { key: string; label: string; unit: string }[] = [
  { key: "sbp", label: "수축기 혈압", unit: "mmHg" },
  { key: "dbp", label: "이완기 혈압", unit: "mmHg" },
  { key: "fasting_glucose", label: "공복혈당", unit: "mg/dL" },
  { key: "hba1c", label: "당화혈색소", unit: "%" },
  { key: "total_chol", label: "총콜레스테롤", unit: "mg/dL" },
  { key: "ldl", label: "LDL", unit: "mg/dL" },
  { key: "hdl", label: "HDL", unit: "mg/dL" },
  { key: "triglyceride", label: "중성지방", unit: "mg/dL" },
  { key: "weight_kg", label: "체중", unit: "kg" },
  { key: "waist_cm", label: "허리둘레", unit: "cm" },
];

/**
 * 서버 응답을 저장용으로 줄인다.
 *
 * `reliability`(구간 10개)와 `top_factors` 는 화면이 안 쓰는데 기록마다 쌓인다.
 * 상한이 없는 목록이라 몇 년 치가 모이면 보관함이 그만큼 커진다.
 */
function storeVerdict(verdict: DiseaseVerdict): StoredVerdict {
  const reference = verdict.reference;
  return {
    key: verdict.key,
    name: verdict.name,
    engine: verdict.engine,
    engine_label: verdict.engine_label,
    engine_reason: verdict.engine_reason,
    risk_level: verdict.risk_level,
    sub_status: verdict.sub_status,
    display_label: verdict.display_label,
    reason: verdict.reason,
    criteria_reference: verdict.criteria_reference,
    recommendation: verdict.recommendation,
    missing_fields: verdict.missing_fields,
    flags: verdict.flags,
    superseded_by: verdict.superseded_by,
    disclaimer: verdict.disclaimer,
    reference: reference
      ? {
          probability: reference.probability,
          peer_percentile: reference.peer_percentile,
          peer_group: reference.peer_group,
          peer_ratio: reference.peer_ratio,
          accuracy: reference.accuracy,
        }
      : null,
  };
}

function storeRisk(risk: DiseaseRisk): StoredRisk {
  return {
    category: risk.category,
    risk_level: risk.risk_level,
    sub_status: risk.sub_status,
    display_label: risk.display_label,
    reason: risk.reason,
    criteria_reference: risk.criteria_reference,
    recommendation: risk.recommendation,
    missing_fields: risk.missing_fields,
    contributors: risk.contributors,
    score: risk.score,
  };
}

export async function saveSnapshot(
  runtime: LocalDomainRuntime,
  profileId: string,
  values: Record<string, string>,
  result: AssessmentSummaryData,
  recordedAt: string = new Date().toISOString(),
  source: "manual" | "ocr" = "manual",
): Promise<Snapshot> {
  const payload: AssessmentSnapshotPayload = {
    inputs: toRequestBody(values) as AssessmentSnapshotPayload["inputs"],
    levels: Object.fromEntries(result.verdicts.map((v) => [v.key, v.risk_level])),
    engines: Object.fromEntries(result.verdicts.map((v) => [v.key, v.engine])),
    bmi: result.bmi,
    evaluated: result.summary.evaluated,
    total: result.summary.total,
    highestLevel: result.summary.highest_level,
    // 카드 원본. `levels` 만으로는 "고혈압 높음" 까지만 복원되고, 사용자가 그날
    // 실제로 읽은 근거·엔진·밀려난 확률이 전부 사라진다.
    verdicts: result.verdicts.map(storeVerdict),
    matrix: Object.values(result.disease_risks ?? {}).map(storeRisk),
  };

  const created = await runtime.healthRecords.create<AssessmentSnapshotPayload>({
    householdId: PRIMARY_HOUSEHOLD_ID,
    profileId,
    recordType: "assessment",
    recordedAt,
    // 검진표에서 읽어 채운 값이면 `ocr`. 나중에 "이 숫자는 어디서 왔나"를 설명할
    // 재료이자, 인식 품질을 되짚을 유일한 흔적이다.
    source,
    payload,
  });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  return created.value;
}

/** 오래된 것부터. 차트가 왼쪽에서 오른쪽으로 흐른다. */
export async function listSnapshots(runtime: LocalDomainRuntime, profileId: string): Promise<Snapshot[]> {
  const found = await runtime.healthRecords.query({ profileId, recordTypes: ["assessment"] });
  if (!found.ok) return [];
  // `query` 는 payload 를 `Record<string, unknown>` 으로 되돌린다 — 복호화 시점에
  // 타입을 모르기 때문이다. `recordType` 으로 이미 걸렀으므로 여기서 좁힌다.
  const snapshots = found.value as unknown as Snapshot[];
  return snapshots.slice().sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

export interface SeriesPoint {
  at: string;
  value: number;
}

export interface TrendSeries {
  key: string;
  label: string;
  unit: string;
  points: SeriesPoint[];
}

/**
 * 두 시점 이상에서 관측된 수치만 계열로 만든다.
 *
 * 한 점짜리 계열을 그리면 선이 없는 축만 남고, 사용자는 "고장났다"로 읽는다.
 * 그릴 것이 없으면 없다고 말하는 편이 낫다.
 */
export function buildSeries(snapshots: Snapshot[]): TrendSeries[] {
  const series: TrendSeries[] = [];
  for (const spec of TREND_SERIES) {
    const points: SeriesPoint[] = [];
    for (const snapshot of snapshots) {
      const raw = snapshot.payload.inputs?.[spec.key];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        points.push({ at: snapshot.recordedAt, value: raw });
      }
    }
    if (points.length >= 2) series.push({ ...spec, points });
  }
  return series;
}

export interface LevelTrack {
  key: string;
  levels: (string | undefined)[];
  engines: (string | undefined)[];
  /** 정본 엔진이 바뀐 지점의 인덱스. 차트가 여기에 표를 세운다. */
  engineChanges: number[];
}

/** 질환별 등급 궤적. 값이 바뀐 질환만 낸다 — 안 바뀐 줄을 스무 개 그리면 못 읽는다. */
export function buildLevelTracks(snapshots: Snapshot[]): LevelTrack[] {
  const keys = new Set<string>();
  for (const snapshot of snapshots) {
    for (const key of Object.keys(snapshot.payload.levels ?? {})) keys.add(key);
  }

  const tracks: LevelTrack[] = [];
  for (const key of keys) {
    const levels = snapshots.map((s) => s.payload.levels?.[key]);
    const engines = snapshots.map((s) => s.payload.engines?.[key]);
    const changed = new Set(levels.filter(Boolean)).size > 1;
    const engineChanges = engines.reduce<number[]>((acc, engine, index) => {
      if (index > 0 && engine && engines[index - 1] && engine !== engines[index - 1]) acc.push(index);
      return acc;
    }, []);
    if (changed || engineChanges.length > 0) tracks.push({ key, levels, engines, engineChanges });
  }
  return tracks;
}

/**
 * 가족 홈의 구성원 카드가 쓰는 한 줄 요약 — **가장 최근 판정만.**
 *
 * 카드에 추이를 그리지 않는 이유는 자리다. 카드 한 장이 아바타·이름·관계까지 이미
 * 물고 있어서, 여기서 필요한 것은 "지금 이 사람을 열어 봐야 하나" 하나다.
 */
export interface LatestSummary {
  recordedAt: string;
  highestLevel: string;
  evaluated: number;
  total: number;
  /** 주의 이상인 질환 수. 카드가 숫자 하나로 급한 정도를 말한다. */
  needsAttention: number;
}

const ATTENTION = new Set(["CAUTION", "HIGH", "VERY_HIGH"]);

export function summarizeLatest(snapshots: Snapshot[]): LatestSummary | undefined {
  const last = snapshots.at(-1);
  if (!last) return undefined;
  return {
    recordedAt: last.recordedAt,
    highestLevel: last.payload.highestLevel,
    evaluated: last.payload.evaluated,
    total: last.payload.total,
    needsAttention: Object.values(last.payload.levels ?? {}).filter((level) => ATTENTION.has(level)).length,
  };
}

/**
 * 구성원 전체의 최근 판정을 한 번에.
 *
 * 순차로 훑는다. 보관함 조회는 복호화를 끼고 있어 동시에 던지면 CPU 가 몰리는데,
 * 가족 구성원은 많아야 대여섯이라 병렬로 얻을 이득이 없다.
 */
export async function listLatestByProfile(
  runtime: LocalDomainRuntime,
  profileIds: string[],
): Promise<Record<string, LatestSummary>> {
  const summaries: Record<string, LatestSummary> = {};
  for (const profileId of profileIds) {
    const found = summarizeLatest(await listSnapshots(runtime, profileId));
    if (found) summaries[profileId] = found;
  }
  return summaries;
}
