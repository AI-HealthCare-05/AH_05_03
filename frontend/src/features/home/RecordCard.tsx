/**
 * 기록 한 건을 목록에서 보여 주는 카드. **여러 화면이 이것을 같이 쓴다.**
 *
 * 왜 뽑았나
 * ---------
 * 가족 홈의 "최근 건강기록" 과 판정 화면의 "남긴 기록에서" 가 같은 기록을 서로
 * 다르게 그렸다. 홈은 종류 표시·이름·요약·시각이 붙은 카드였고, 판정 화면은 칸
 * 이름과 숫자가 평평하게 늘어선 목록이었다. 같은 것을 두 모양으로 배우게 하는
 * 셈이라, 사용자가 "왜 두 개가 다른 방식으로 뜨는지 모르겠다" 고 한 자리다.
 *
 * 종류 이름은 `recordTypeLabel` 한 곳에서 온다. 예전에는 홈이 자기 표를 따로
 * 들고 있었고 **이미 어긋나 있었다** — 같은 종류가 홈에서는 "신체 측정", 요약에서는
 * "체성분" 이었다. 사본을 지우고 공유 쪽으로 모았다.
 */

import { recordSummary, recordTypeLabel } from "../../shared/local/recordSummary";
import type { HealthRecord, HealthRecordType } from "../../shared/local/domainContracts";

/** 종류를 한 글자로. 목록에서 눈이 먼저 잡는 표시다. */
export function recordMark(type: HealthRecordType): string {
  if (type === "health_screening" || type === "lab_result") return "검";
  if (type === "pain") return "통";
  if (type === "blood_pressure" || type === "blood_glucose") return "수";
  return "기";
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RecordCard({
  record,
  actionLabel = "자세히 보기",
  pressed,
  onOpen,
  /** 요약 자리에 대신 그릴 것. 판정 기록은 등급 배지까지 붙는다. */
  summary,
}: {
  record: HealthRecord;
  actionLabel?: string;
  pressed?: boolean;
  onOpen: () => void;
  summary?: React.ReactNode;
}) {
  return (
    <li>
      <span className="record-type-mark" aria-hidden="true">
        {recordMark(record.recordType)}
      </span>
      <div>
        <strong>{recordTypeLabel(record.recordType)}</strong>
        {summary ?? <p className="record-summary-line">{recordSummary(record)}</p>}
      </div>
      <time dateTime={record.recordedAt}>{formatDateTime(record.recordedAt)}</time>
      {/* **한 줄에 동작을 두 개 두지 않는다.** 예전에는 `수정`·`삭제` 가 바로 여기
          있었다. 목록은 훑는 자리인데 그 자리에 되돌릴 수 없는 동작(삭제)이 있으면
          훑다가 잘못 누르는 것이 삭제가 되고, 무엇을 고치는지 보기 전에 고치기
          버튼을 먼저 만난다. 열어 보는 문 하나만 두고, 나머지는 내용을 본 뒤 한다. */}
      <div className="record-row-actions">
        <button type="button" aria-pressed={pressed} onClick={onOpen}>
          {actionLabel}
        </button>
      </div>
    </li>
  );
}
