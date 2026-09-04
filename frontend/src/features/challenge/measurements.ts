/**
 * 측정값 로컬 저장.
 *
 * 챌린지 제출은 두 갈래로 갈린다 — **값은 여기(브라우저 암호화 보관함), 사실은 서버.**
 * 이 파일이 앞쪽을 맡는다.
 *
 * `recordType` 을 새로 만들지 않았다. `domainContracts.ts` 에 `blood_pressure` ·
 * `body_measurement` · `lab_result` 가 이미 있고, 챌린지 항목 셋이 정확히 거기에
 * 대응한다. 새 타입을 더하면 같은 혈압이 두 종류로 갈려서 백업·병합·조회가 전부
 * 두 갈래를 알아야 한다.
 *
 * 값 키는 `assessment/snapshots.ts` 의 `TREND_SERIES` 와 같은 이름이다. 달라지면
 * 같은 체중이 두 계열로 갈려 추적 대시보드에서 선이 끊긴다.
 */

import { PRIMARY_HOUSEHOLD_ID } from "../../app/localDomainContext";
import type { HealthRecordType } from "../../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";

/** 챌린지 항목 → 기존 로컬 기록 종류. */
export const RECORD_TYPE_BY_CHALLENGE: Record<string, HealthRecordType> = {
  weight: "body_measurement",
  bp: "blood_pressure",
  lab: "lab_result",
};

export interface MeasurementPayload {
  /** 어떤 측정 챌린지에서 왔는가. 나중에 "챌린지로 남긴 값" 을 가려낼 재료다. */
  challengeId: string;
  /** 실제 수치. 키는 `TREND_SERIES` 와 같다. */
  values: Record<string, number>;
}

export async function saveMeasurement(
  runtime: LocalDomainRuntime,
  profileId: string,
  challengeId: string,
  values: Record<string, number>,
  recordedAt: string = new Date().toISOString(),
): Promise<void> {
  const recordType = RECORD_TYPE_BY_CHALLENGE[challengeId];
  if (!recordType) {
    throw new Error(`측정 종류를 알 수 없습니다: ${challengeId}`);
  }
  const created = await runtime.healthRecords.create<MeasurementPayload>({
    householdId: PRIMARY_HOUSEHOLD_ID,
    profileId,
    recordType,
    recordedAt,
    source: "manual",
    payload: { challengeId, values },
  });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
}

/** 최근에 넣은 값부터. 화면이 "지난번 76.2kg" 을 보여 줄 재료다. */
export async function listMeasurements(
  runtime: LocalDomainRuntime,
  profileId: string,
): Promise<{ recordedAt: string; payload: MeasurementPayload }[]> {
  const found = await runtime.healthRecords.query({
    profileId,
    recordTypes: Object.values(RECORD_TYPE_BY_CHALLENGE),
  });
  if (!found.ok) return [];
  const records = found.value as unknown as { recordedAt: string; payload: MeasurementPayload }[];
  return records.slice().sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}
