/**
 * 기록 한 줄이 쓰는 순수 계산. **컴포넌트와 파일을 가른다.**
 *
 * 한 파일에서 컴포넌트와 상수를 같이 내보내면 fast refresh 가 꺼진다(리액트 플러그인
 * 규칙). 화면 코드에서 자주 걸리는 자리라 처음부터 갈라 둔다.
 */

import { LEVEL_LABEL, type RiskLevel } from "../assessment/contracts";
import { TREND_SERIES } from "../assessment/snapshots";
import type { AssessmentSnapshotPayload, HealthRecord } from "../../shared/local/domainContracts";

export const LEVEL_TONE: Record<string, string> = {
  VERY_HIGH: "tone-very-high",
  HIGH: "tone-high",
  CAUTION: "tone-caution",
  NORMAL: "tone-normal",
  INSUFFICIENT_DATA: "tone-unknown",
};

export const ATTENTION = new Set(["CAUTION", "HIGH", "VERY_HIGH"]);

export function snapshot(record: HealthRecord): AssessmentSnapshotPayload {
  return record.payload as unknown as AssessmentSnapshotPayload;
}

export function levelLabel(level: string): string {
  return LEVEL_LABEL[level as RiskLevel] ?? level;
}

/**
 * 목록에 띄울 수치 몇 개.
 *
 * `TREND_SERIES` 순서를 그대로 쓴다. 혈압·혈당이 앞에 있어서, 한 줄에 서넛만
 * 잘라도 사람이 가장 먼저 확인하는 값이 남는다.
 */
export function headline(inputs: AssessmentSnapshotPayload["inputs"], limit: number): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  for (const spec of TREND_SERIES) {
    const raw = inputs?.[spec.key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    out.push({ key: spec.key, text: `${spec.label} ${raw}${spec.unit ? ` ${spec.unit}` : ""}` });
    if (out.length >= limit) break;
  }
  return out;
}
