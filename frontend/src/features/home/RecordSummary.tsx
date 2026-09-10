/**
 * 기록 목록 한 줄.
 *
 * `RecordDetail`(모달)과 **파일을 갈랐다.** 목록은 홈을 열면 바로 보이고 모달은
 * 눌러야 뜨는데, 한 파일에 있으면 모달이 끌어오는 판정 카드 일체(`VerdictCards` ·
 * `fields`)가 홈의 첫 청크에 같이 실린다. 기록을 한 번도 안 열어 본 사용자도
 * 그 코드를 내려받는다.
 */

import type { HealthRecord } from "../../shared/local/domainContracts";
import { recordSummary } from "../../shared/local/recordSummary";
import { ATTENTION, LEVEL_TONE, headline, levelLabel, snapshot } from "./recordSummaryData";

/** 목록 한 줄. 판정이면 등급과 수치를, 나머지는 정본 요약기가 만든 한 줄을 낸다. */
export function RecordSummary({ record }: { record: HealthRecord }) {
  if (record.recordType !== "assessment") {
    // **메모를 그대로 내던 자리다.** 검진표 기록의 메모는 OCR 전문이라 목록 한 줄에
    // 수십 줄이 쏟아졌고, 메모가 없는 기록은 "저장된 건강기록" 이라고만 적혔다.
    // 둘 다 같은 원인이다 — 수치를 안 읽었다. 읽는 방법은 `recordSummary` 한 곳에 있다.
    return <p className="record-summary-line">{recordSummary(record)}</p>;
  }

  const payload = snapshot(record);
  const levels = Object.values(payload.levels ?? {});
  const attention = levels.filter((level) => ATTENTION.has(level)).length;
  const values = headline(payload.inputs, 3);

  return (
    <div className="record-assessment">
      <span className={`record-level ${LEVEL_TONE[payload.highestLevel] ?? "tone-unknown"}`}>
        {levelLabel(payload.highestLevel)}
      </span>
      <span className="record-assessment-meta">
        {payload.evaluated}/{payload.total}개 판정 · 주의 {attention}개
        {payload.bmi ? ` · BMI ${payload.bmi.toFixed(1)}` : ""}
      </span>
      {values.length > 0 ? (
        <span className="record-assessment-values">{values.map((v) => v.text).join(" · ")}</span>
      ) : null}
    </div>
  );
}
