/**
 * 판정 시점 스냅샷 — 추적 대시보드의 재료.
 *
 * 어디에 남는가
 * -------------
 * **로컬 보관함에 쓰고, 동기화가 PostgreSQL 로 옮긴다**(ADR-011, 2026-09-04 승인).
 * 그 ADR 이 ADR-001·002 의 "건강정보 서버 미전송" 을 대체했으므로 이 머리말에 있던
 * "서버는 판정을 저장하지 않는다" 는 더 이상 사실이 아니다 — 실측으로 `health_records`
 * 에 assessment 12행이 들어가 있었다. 이미 있는 `HealthRecord` 배선을 그대로 쓰고
 * `recordType` 만 `"assessment"` 로 더했다.
 *
 * 왜 등급까지 남기는가
 * --------------------
 * 입력값만 남기고 나중에 재채점하면 편할 것 같지만 **그날 사용자가 본 화면과 다른
 * 그래프가 그려진다.** 번들은 재학습으로 갱신되고 규칙 임계값도 지침 개정으로 바뀐다.
 * 추적은 그날 본 것을 이어야 뜻이 있다.
 */

import { PRIMARY_HOUSEHOLD_ID } from "../../app/localDomainContext";
import type {
  AssessmentRun,
  AssessmentSnapshotPayload,
  HealthRecord,
  StoredRisk,
  StoredVerdict,
} from "../../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
import type { AssessmentSummaryData, DiseaseRisk, DiseaseVerdict } from "./contracts";
import { IDENTITY_FIELDS, toRequestBody } from "./fields";

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

/**
 * 바로 앞 기록과 **같은 값·같은 등급**인가.
 *
 * 판정하기를 누를 때마다 자동으로 한 점이 쌓인다. 그래서 "지난 판정으로 채우기" 로
 * 값을 되불러와 다시 판정하면 **한 글자도 안 바뀐 점**이 계속 늘어난다. 실측으로
 * 같은 날 8,603 바이트짜리 행이 두 번 나란히 저장돼 있었다.
 *
 * 추적 그래프에서 변화 없는 점은 정보가 아니라 잡음이다 — 가로축만 늘리고 실제로
 * 움직인 구간을 좁힌다. 입력과 등급이 둘 다 같으면 새 점을 만들지 않는다.
 *
 * **시각은 안 고친다.** 그날 본 화면을 남기는 것이 스냅샷의 존재 이유라, 나중에
 * 같은 값을 다시 눌렀다고 예전 기록의 시각을 바꾸면 그 기록이 가리키던 시점이
 * 사라진다.
 */
function sameInputs(
  previous: AssessmentSnapshotPayload["inputs"] | undefined,
  next: AssessmentSnapshotPayload["inputs"],
): boolean {
  // 키 순서가 달라도 같은 입력이다. `toRequestBody` 가 필드 순서를 보장하지 않는다.
  const normalise = (value: Record<string, unknown> | undefined) =>
    JSON.stringify(Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b))));
  return normalise(previous) === normalise(next);
}

export interface SaveOutcome {
  snapshot: Snapshot;
  /** 무엇을 했는가. 화면이 사용자에게 그대로 말한다. */
  kind: "created" | "rechecked" | "changed";
  /** `changed` 일 때 몇 차인지. 1차는 기록이 만들어질 때다. */
  run: number;
}

/** 저장된 회차 목록. 옛 기록에는 `runs` 가 없으므로 본문에서 1차를 만들어 준다. */
export function runsOf(payload: AssessmentSnapshotPayload): AssessmentRun[] {
  if (payload.runs?.length) return payload.runs;
  return [{ at: "", levels: payload.levels ?? {}, highestLevel: payload.highestLevel ?? "" }];
}

export async function saveSnapshot(
  runtime: LocalDomainRuntime,
  profileId: string,
  values: Record<string, string>,
  result: AssessmentSummaryData,
  recordedAt: string = new Date().toISOString(),
  source: "manual" | "ocr" = "manual",
  /** 이 판정을 채운 검진표. 있으면 기록에 매달아 나중에 원본을 열 수 있게 한다. */
  sourceDocumentId?: string,
  /**
   * 이 판정이 쓴 **수치 기록**의 id.
   *
   * 판정은 수치에서 나온 것이므로 목록에 둘이 나란히 서면 같은 일이 두 줄로 보인다.
   * 이 고리가 있으면 목록은 수치 기록만 세우고, 판정은 그 기록의 자세히에서 열린다.
   * 고리가 없는 판정은 갈 곳이 없으므로 목록에 그대로 남는다 — 숨기면 사라진다.
   */
  sourceRecordId?: string,
): Promise<SaveOutcome> {
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
    ...(sourceRecordId ? { sourceRecordId } : {}),
  };

  // **입력이 같으면 새 기록을 만들지 않는다.** 기록 하나가 곧 입력값 한 벌이다.
  const existing = await listSnapshots(runtime, profileId);
  const latest = existing.at(-1);
  if (latest && sameInputs(latest.payload.inputs, payload.inputs)) {
    const runs = runsOf(latest.payload);
    const unchanged = JSON.stringify(runs.at(-1)?.levels ?? {}) === JSON.stringify(payload.levels ?? {});
    // 등급까지 같으면 회차를 늘리지 않는다. 같은 값을 같은 모델로 또 돌린 것뿐이라
    // 남길 것이 "언제 다시 확인했나" 하나다.
    const nextRuns = unchanged
      ? runs
      : [...runs, { at: recordedAt, levels: payload.levels, highestLevel: payload.highestLevel }];
    const merged: AssessmentSnapshotPayload = {
      ...latest.payload,
      checkedAt: recordedAt,
      runs: nextRuns,
      // 등급이 바뀌었으면 카드 원본도 최신으로 바꾼다 — 기록을 열었을 때 마지막으로
      // 본 화면이 나와야 한다. 안 바뀌었으면 손대지 않는다.
      ...(unchanged
        ? {}
        : {
            levels: payload.levels,
            engines: payload.engines,
            highestLevel: payload.highestLevel,
            evaluated: payload.evaluated,
            total: payload.total,
            verdicts: payload.verdicts,
            matrix: payload.matrix,
          }),
    };
    const updated = await runtime.healthRecords.update<AssessmentSnapshotPayload>(latest.id, {
      recordType: "assessment",
      // **시각은 안 옮긴다.** 그날 본 화면을 남기는 것이 스냅샷의 존재 이유라,
      // 다시 확인했다고 예전 기록의 시점을 바꾸면 그 점이 가리키던 날이 사라진다.
      recordedAt: latest.recordedAt,
      payload: merged,
      expectedVersion: latest.version,
    });
    if (!updated.ok) throw new Error(updated.error.message);
    return {
      snapshot: updated.value,
      kind: unchanged ? "rechecked" : "changed",
      run: nextRuns.length,
    };
  }

  payload.runs = [{ at: recordedAt, levels: payload.levels, highestLevel: payload.highestLevel }];
  payload.checkedAt = recordedAt;
  const created = await runtime.healthRecords.create<AssessmentSnapshotPayload>({
    householdId: PRIMARY_HOUSEHOLD_ID,
    profileId,
    recordType: "assessment",
    recordedAt,
    // 검진표에서 읽어 채운 값이면 `ocr`. 나중에 "이 숫자는 어디서 왔나"를 설명할
    // 재료이자, 인식 품질을 되짚을 유일한 흔적이다.
    source,
    payload,
    // **원본과 판정을 잇는 유일한 고리다.** 이게 없으면 검진표는 보관함에, 판정은
    // 기록에 따로 남아서 "이 숫자는 어느 서류에서 왔나" 에 답할 수 없다.
    sourceDocumentId,
  });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  return { snapshot: created.value, kind: "created", run: 1 };
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
 * **순차로 훑었다.** "보관함 조회는 복호화를 끼고 있어 동시에 던지면 CPU 가 몰린다"
 * 는 것이 이유였는데, 그 전제는 기기 안 런타임(IndexedDB + 복호화) 시절 것이다.
 * ADR-011 이후 정본이 서버로 옮겨 가면서 이 조회는 구성원마다 **왕복 한 번**이
 * 됐고(`/api/v1/health-records?profile_id=…`), CPU 가 아니라 그물망이 병목이다.
 * 넷이면 넷을 줄 세우느라 왕복 넷이 직렬로 쌓인다(실측 왕복당 약 300ms).
 *
 * 같이 던진다. 대여섯 개를 한꺼번에 여는 것은 브라우저 동시 연결 한도 안이고,
 * 한 사람 조회가 실패해도 나머지는 그대로 보여 준다 — 한 칸 배지가 비는 것이
 * 목록 전체가 비는 것보다 낫다.
 */
export async function listLatestByProfile(
  runtime: LocalDomainRuntime,
  profileIds: string[],
): Promise<Record<string, LatestSummary>> {
  const found = await Promise.all(
    profileIds.map(async (profileId) => {
      try {
        return [profileId, summarizeLatest(await listSnapshots(runtime, profileId))] as const;
      } catch {
        return [profileId, undefined] as const;
      }
    }),
  );

  const summaries: Record<string, LatestSummary> = {};
  for (const [profileId, summary] of found) {
    if (summary) summaries[profileId] = summary;
  }
  return summaries;
}

/**
 * 손으로 채운 판정 값을 **수치 기록으로** 남긴다. 판정에 매달 고리를 돌려준다.
 *
 * 검진표에서 읽은 값은 문서를 붙인 그 자리에서 이미 `health_screening` 으로 남는다
 * (`AssessmentPage.saveScreening`). 손으로 채운 값에는 그런 기록이 없어서, 판정만
 * 남고 그 판정이 쓴 수치는 판정 안(`payload.inputs`)에만 갇혀 있었다.
 *
 * 그래서 두 경로가 갈렸다 — 추이 그래프와 판정 채우기는 수치 기록을 읽는데, 손으로
 * 채운 값은 그 목록에 안 나온다. **같은 모양으로 남긴다**(`payload.values`, 판정 칸
 * 이름 → 값). 서버 `record_prefill.fields_for` 가 그 칸을 정본으로 읽는다.
 *
 * `sex` 처럼 숫자가 아닌 칸은 담지 않는다 — 수치 기록이 아니라 사람의 속성이고,
 * 프로필이 이미 들고 있다.
 */
export async function saveTypedValues(
  runtime: LocalDomainRuntime,
  profileId: string,
  values: Record<string, string>,
): Promise<string | undefined> {
  const numeric: Record<string, number> = {};
  for (const [field, raw] of Object.entries(values)) {
    if (raw === "" || raw === undefined) continue;
    // 나이·성별은 측정값이 아니다. 실어 두면 나중에 이 기록을 골라 쓸 때
    // **그때의 나이가 오늘 판정에 덮인다**(`IDENTITY_FIELDS` 머리말).
    if (IDENTITY_FIELDS.has(field)) continue;
    // 참·거짓 칸은 폼이 문자열로 들고 있다. 판정이 읽는 모양(1/0)으로 되돌린다.
    if (raw === "true" || raw === "false") {
      numeric[field] = raw === "true" ? 1 : 0;
      continue;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) numeric[field] = parsed;
  }
  if (Object.keys(numeric).length === 0) return undefined;

  const created = await runtime.healthRecords.create({
    householdId: PRIMARY_HOUSEHOLD_ID,
    profileId,
    recordType: "health_screening",
    recordedAt: new Date().toISOString(),
    source: "manual",
    payload: {
      type: "health_screening",
      screeningName: "직접 입력한 수치",
      values: numeric,
      note: `판정 화면에서 ${Object.keys(numeric).length}개 수치를 직접 넣었습니다.`,
    },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value.id;
}
