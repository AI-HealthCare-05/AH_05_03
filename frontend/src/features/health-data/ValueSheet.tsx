/**
 * 기록 하나에 담긴 **수치를 판정 폼과 같은 칸으로** 보여 주고 고친다.
 *
 * 왜 이 파일이 생겼나
 * -------------------
 * 검진표를 저장한 기록을 열면 볼 것이 없었다. `RecordDetail` 은 판정 스냅샷 전용
 * 화면이라 `payload.inputs` 만 읽는데, 검진 기록에는 그 칸이 없다 — 그래서 21개
 * 항목이 담긴 기록이 **"그날 넣은 값 0개"** 로 떴다. 고치는 화면은 또 달랐다.
 * 건강 데이터 쪽 편집기는 OCR 이 읽은 **행 이름**으로 칸을 만들었으므로, 읽히지
 * 않은 항목은 화면에 아예 없어서 손으로 채울 수도 없었다.
 *
 * 그래서 한 양식으로 모았다. 이 파일이 두 화면에서 같이 쓰인다.
 *
 *     기록 자세히(`RecordDetail`)  ·  건강 데이터의 검진 수치 수정
 *
 * ## 왜 빈 칸까지 보여 주는가
 *
 * 검진표에서 읽히는 것은 스무 칸 중 열 몇 칸이다. 읽힌 것만 보여 주면 **무엇이
 * 모자라서 판정이 안 되는지**를 화면이 끝내 말하지 않는다. 칸을 다 세워 두면 빈
 * 자리가 곧 "여기를 채우면 판정된다" 가 된다.
 *
 * 단순한 기록(혈압 한 줄)에는 서른여섯 칸을 세우지 않는다 — 그쪽은 담긴 값이 전부다.
 *
 * ## 고친 값과 원본
 *
 * 고친 값은 `payload.values`(판정 칸 이름 → 값)에 남기고 `payload.items`(OCR 이
 * 읽은 행)는 **건드리지 않는다.** 원본이 무엇이라고 적혀 있었는지는 남아야 하기
 * 때문이다. 둘이 다르면 `values` 가 이긴다 — 서버 `record_prefill.fields_for` 가
 * 같은 순서로 쌓는다.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { FIELD_BY_NAME, FIELD_GROUPS, IDENTITY_FIELDS } from "../assessment/fields";
import { useLocalDomain } from "../../app/localDomainContext";
import { serverApiClient } from "../../shared/api/serverApiClient";
import { recordSummary } from "../../shared/local/recordSummary";
import type { HealthRecord } from "../../shared/local/domainContracts";
import { Modal } from "../../shared/ui/Modal";

/** 판정 칸을 다 세울 기록인가. 검진표·검사 결과처럼 **여러 항목이 오는** 종류만. */
export function showsEveryField(record: HealthRecord): boolean {
  return (
    record.recordType === "health_screening" ||
    record.recordType === "lab_result" ||
    record.source === "ocr" ||
    Boolean(record.sourceDocumentId)
  );
}

/** `payload.values` 에 이미 정리돼 있는 값. */
function storedValues(record: HealthRecord): Record<string, number> {
  const payload = record.payload as Record<string, unknown>;
  const raw = payload.values;
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object") {
    for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
      const parsed = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(parsed)) out[field] = parsed;
    }
  }
  return out;
}

/**
 * 이 기록의 판정 칸 값. 두 곳에서 온다.
 *
 * * `payload.values` — 이미 판정 칸 이름으로 정리된 것(즉시 저장·편집기가 쓴 모양)
 * * 서버 `/values` — OCR 행만 담긴 옛 기록. 표기를 칸에 잇는 사전이 서버에만 있다
 *
 * 서버를 못 부르면(로그아웃·오프라인) 앞의 것만 쓴다. 그때 화면은 빈 칸이 많아
 * 보이지만 **틀린 값을 보여 주는 것보다 낫다.**
 */
export function useCanonicalValues(record: HealthRecord): {
  values: Record<string, number>;
  loading: boolean;
} {
  const stored = useMemo(() => storedValues(record), [record]);
  const [resolved, setResolved] = useState<Record<string, number>>(stored);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // 정리된 맵이 이미 있으면 서버에 묻지 않는다.
    if (Object.keys(stored).length > 0) {
      setResolved(stored);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const server = await serverApiClient.readRecordValues(record.id);
        if (!cancelled) setResolved(server.values ?? {});
      } catch {
        // 사전을 못 태웠다. 담긴 그대로만 보여 준다.
        if (!cancelled) setResolved(stored);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [record.id, stored]);

  return { values: resolved, loading };
}

export function ValueSheet({
  record,
  values,
  loading,
  editable,
  onSaved,
  onCancel,
}: {
  record: HealthRecord;
  /** 판정 칸 값. 조회는 `useCanonicalValues` 가 한 번만 한다. */
  values: Record<string, number>;
  loading?: boolean;
  /** 고칠 수 있는가. 자세히는 읽기로 열고, 수정을 누르면 이 값이 켜진다. */
  editable: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const { updateHealthRecord } = useLocalDomain();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  // 서버에서 값이 늦게 와도 폼이 비어 있지 않게 다시 seed 한다. 사용자가 이미 고친
  // 칸은 남긴다 — 늦게 온 응답이 방금 친 숫자를 덮으면 그건 버그로 읽힌다.
  useEffect(() => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const [field, value] of Object.entries(values)) {
        if (next[field] === undefined) next[field] = String(value);
      }
      return next;
    });
  }, [values]);

  const everyField = showsEveryField(record);

  /** 세울 칸. 검진 기록은 전부, 그 밖은 담긴 값만. */
  const groups = useMemo(() => {
    // 나이·성별은 이 검진이 잰 것이 아니라 사람의 속성이다(`IDENTITY_FIELDS`).
    // 빈 칸으로 세우면 사용자가 채워야 할 것으로 읽힌다.
    const shown = (field: { name: string }) => !IDENTITY_FIELDS.has(field.name);
    const present = new Set(Object.keys(values));
    return FIELD_GROUPS.map((group) => ({
      ...group,
      fields: group.fields.filter(
        (field) => shown(field) && (everyField || present.has(field.name)),
      ),
    })).filter((group) => group.fields.length > 0);
  }, [everyField, values]);

  const filled = Object.values(draft).filter((value) => value !== "").length;

  async function save() {
    setWorking(true);
    setError(undefined);
    try {
      const next: Record<string, number> = {};
      for (const [field, raw] of Object.entries(draft)) {
        if (raw === "") continue;
        const spec = FIELD_BY_NAME[field];
        // 참·거짓 칸은 숫자로 남긴다(판정 폼이 그렇게 읽는다).
        if (spec?.kind === "bool") {
          next[field] = raw === "true" ? 1 : 0;
          continue;
        }
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) next[field] = parsed;
      }
      const payload = record.payload as Record<string, unknown>;
      await updateHealthRecord(record.id, {
        recordType: record.recordType,
        recordedAt: record.recordedAt,
        note: typeof payload.note === "string" ? payload.note : "",
        expectedVersion: record.version,
        // **`values` 만 보낸다.** `updateHealthRecord` 가 나머지 칸을 합쳐 주므로
        // `items` 는 그대로 남는다 — 원본이 무엇이라고 적혀 있었는지는 지우지 않는다.
        payload: { values: next },
      });
      onSaved?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "수치를 저장하지 못했어요.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="value-sheet">
      {loading ? <p className="assess-muted">검진표에서 읽은 값을 불러오고 있어요…</p> : null}

      {everyField ? (
        <p className="form-notice">
          검진표에서 읽은 값은 채워져 있고, 빈 칸은 읽히지 않은 항목입니다.
          {editable ? " 빈 칸을 채우면 그만큼 판정할 수 있는 질환이 늘어납니다." : null}
        </p>
      ) : null}

      {groups.map((group) => (
        <fieldset className="value-sheet-group" key={group.key}>
          <legend>{group.title}</legend>
          <div className="value-sheet-fields">
            {group.fields.map((field) => {
              const current = draft[field.name] ?? "";
              const fromDocument = values[field.name] !== undefined;
              return (
                <label
                  className={fromDocument ? "value-sheet-field is-read" : "value-sheet-field"}
                  key={field.name}
                >
                  <span className="value-sheet-label">
                    {field.label}
                    {field.unit ? <span className="assess-unit"> {field.unit}</span> : null}
                  </span>
                  {!editable ? (
                    <strong className={current === "" ? "value-sheet-blank" : undefined}>
                      {current === "" ? "—" : labelFor(field.name, current)}
                    </strong>
                  ) : field.kind === "number" ? (
                    <input
                      type="number"
                      inputMode="decimal"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={current}
                      onChange={(event) => setDraft({ ...draft, [field.name]: event.target.value })}
                    />
                  ) : (
                    <select
                      value={current}
                      onChange={(event) => setDraft({ ...draft, [field.name]: event.target.value })}
                    >
                      <option value="">선택 안 함</option>
                      {optionsFor(field.name).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      {error ? <div className="alert error-alert">{error}</div> : null}

      {editable ? (
        <div className="form-actions">
          <span className="assess-muted value-sheet-count">채운 칸 {filled}개</span>
          {onCancel ? (
            <button className="secondary-button" type="button" onClick={onCancel}>
              취소
            </button>
          ) : null}
          <button className="primary-button" type="button" disabled={working} onClick={() => void save()}>
            {working ? "저장 중…" : "고친 값 저장"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 선택 칸의 보기. 참·거짓은 폼과 같은 문구를 쓴다. */
function optionsFor(name: string): { value: string; label: string }[] {
  const spec = FIELD_BY_NAME[name];
  if (!spec) return [];
  if (spec.kind === "bool") {
    return [
      { value: "true", label: "예" },
      { value: "false", label: "아니오" },
    ];
  }
  return spec.options ?? [];
}

/** 읽기 모드에서 보여 줄 글자. 코드값(`M`·`1`)을 그대로 세우지 않는다. */
function labelFor(name: string, raw: string): string {
  const spec = FIELD_BY_NAME[name];
  if (!spec) return raw;
  if (spec.kind === "bool") return raw === "true" || raw === "1" ? "예" : "아니오";
  const option = (spec.options ?? []).find((item) => item.value === raw);
  return option ? option.label : raw;
}

/**
 * 판정이 아닌 기록의 **자세히**. 검진표·검사 결과·혈압 한 줄이 모두 여기로 온다.
 *
 * `RecordDetail` 은 판정 스냅샷 전용이었다 — `payload.inputs`·`levels`·`verdicts`
 * 만 읽는다. 검진 기록은 그 칸이 없어서 **"그날 넣은 값 0개 · 남아 있는 등급이
 * 없습니다"** 라는, 사실이지만 쓸모없는 화면이 떴다. 담긴 것을 담긴 대로 보여 준다.
 *
 * ## 예측으로 가는 문
 *
 * 수치만 보여 주고 끝내면 "그래서 이걸로 뭘 하냐" 가 남는다. 이 기록에서 나온
 * 판정이 있으면 그리로 보내고, 없으면 이 수치를 들고 판정 화면으로 넘긴다.
 */
export function RecordValueDetail({
  record,
  onClose,
  onDelete,
  onEdit,
  onUse,
  linkedAssessment,
  onViewPrediction,
}: {
  record: HealthRecord;
  onClose: () => void;
  onDelete?: () => void;
  /**
   * 메모를 고치는 폼. **수치가 없는 기록에만 쓴다** — 메모 한 줄짜리 기록에는
   * 판정 칸을 세울 것이 없으므로 이쪽이 유일한 수정 경로다.
   */
  onEdit?: () => void;
  /**
   * 이 수치를 **가져다 쓴다.** 판정 화면이 넘긴다 — 카드를 열어 전체 수치와 원본을
   * 확인한 뒤 그 자리에서 폼으로 옮기는 길이다. 없으면 버튼을 그리지 않는다.
   */
  onUse?: (values: Record<string, number>) => void;
  /** 이 기록에서 나온 판정. 있으면 "예측 결과 보기", 없으면 "예측하기". */
  linkedAssessment?: HealthRecord;
  onViewPrediction?: (assessment: HealthRecord) => void;
}) {
  const navigate = useNavigate();
  const { values, loading } = useCanonicalValues(record);
  const [editing, setEditing] = useState(false);

  const hasValues = Object.keys(values).length > 0;
  // 판정 칸을 세울 기록인가. 아니면 메모·복약처럼 수치가 없는 것이다.
  const sheetWorthy = showsEveryField(record) || hasValues;
  const kicker = showsEveryField(record) ? "검진 기록" : "건강기록";
  const payload = record.payload as Record<string, unknown>;
  const note = typeof payload.note === "string" ? payload.note.trim() : "";

  return (
    <Modal
      kicker={kicker}
      title={new Date(record.recordedAt).toLocaleString("ko-KR")}
      className="record-detail-modal"
      onClose={onClose}
    >
      {/* 수치가 없는 종류(메모·복약·예방접종)는 담긴 것이 글이다. 그것을 세운다. */}
      {!sheetWorthy ? (
        <>
          <p className="record-summary-line">{recordSummary(record)}</p>
          {note ? <p className="form-notice">{note}</p> : null}
        </>
      ) : (
        <ValueSheet
          record={record}
          values={values}
          loading={loading}
          editable={editing}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      )}

      {/* 원본이 붙어 있으면 그 사실을 밝힌다. 읽은 값이 원본과 다를 때 대조할
          곳이 여기뿐이다. */}
      {record.sourceDocumentId ? (
        <p className="assess-fineprint value-sheet-source">
          검진표 원본에서 읽은 기록입니다. 건강 데이터 화면의 검진 이력에서 원본을 열 수 있어요.
        </p>
      ) : null}

      {!editing ? (
        <div className="form-actions">
          {onUse && hasValues ? (
            <button className="primary-button" type="button" onClick={() => onUse(values)}>
              이 수치 사용하기
            </button>
          ) : null}
          {!hasValues ? null : onUse ? null : linkedAssessment && onViewPrediction ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => onViewPrediction(linkedAssessment)}
            >
              예측 결과 보기
            </button>
          ) : (
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                // 판정 화면으로 이 수치를 넘긴다. 폼은 문자열을 받는다.
                const prefill = Object.fromEntries(
                  Object.entries(values).map(([field, value]) => [field, String(value)]),
                );
                onClose();
                void navigate("/assessment", {
                  state: { prefill, profileId: record.profileId, prefillSource: "record" },
                });
              }}
            >
              예측하기
            </button>
          )}
          {sheetWorthy || !onEdit ? (
            <button className="secondary-button" type="button" onClick={() => setEditing(true)}>
              수정
            </button>
          ) : (
            <button className="secondary-button" type="button" onClick={onEdit}>
              수정
            </button>
          )}
          {onDelete ? (
            <button className="danger-button" type="button" onClick={onDelete}>
              삭제
            </button>
          ) : null}
        </div>
      ) : null}

      {sheetWorthy ? (
        <p className="assess-fineprint">
          검진표에서 읽은 값은 원본과 다를 수 있습니다. 수정을 눌러 고치면 추이 그래프와 판정 채우기에 함께
          반영됩니다.
        </p>
      ) : null}
    </Modal>
  );
}
