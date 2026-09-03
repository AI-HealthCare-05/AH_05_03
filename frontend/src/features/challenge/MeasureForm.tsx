/**
 * 측정 입력 폼 — 실제 수치를 넣고 제출한다.
 *
 * **값은 서버로 가지 않는다.** 제출하면 두 가지가 따로 일어난다.
 *
 *   1. 수치는 브라우저 암호화 보관함으로 (`measurements.ts` — 기존 `blood_pressure` ·
 *      `body_measurement` · `lab_result` 기록 종류를 그대로 쓴다)
 *   2. 서버에는 `POST /challenges/checks {challenge_id}` 만 간다 — 쟀다는 사실과 날짜
 *
 * 그래서 제출이 곧 체크다. 사용자가 체크박스를 따로 누를 필요가 없다.
 */

import { useState } from "react";

import type { MeasureItem } from "./contracts";
import { MEASURE_FIELDS } from "./measureFields";

interface Props {
  item: MeasureItem;
  submitting: boolean;
  /** 값은 로컬로, 체크는 서버로. 나누는 일은 화면 바깥에서 한다. */
  onSubmit: (values: Record<string, number>) => void;
}

export function MeasureForm({ item, submitting, onSubmit }: Props) {
  const fields = MEASURE_FIELDS[item.id] ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  const entered = fields
    .map((field) => [field, values[field.key]?.trim() ?? ""] as const)
    .filter(([, raw]) => raw !== "");

  const invalid = entered.filter(([field, raw]) => {
    const parsed = Number(raw);
    return !Number.isFinite(parsed) || parsed < field.min || parsed > field.max;
  });

  // 한 칸이라도 넣으면 제출할 수 있다. 검진 결과지에서 몇 항목만 보이는 경우가 흔하고,
  // 전부 요구하면 그런 사람은 아무것도 못 남긴다.
  const canSubmit = entered.length > 0 && invalid.length === 0 && !submitting;

  return (
    <form
      className="measure-form"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!canSubmit) return;
        onSubmit(Object.fromEntries(entered.map(([field, raw]) => [field.key, Number(raw)])));
        setValues({});
        setTouched(false);
      }}
    >
      <div className="measure-fields">
        {fields.map((field) => {
          const raw = values[field.key]?.trim() ?? "";
          const parsed = Number(raw);
          const bad = raw !== "" && (!Number.isFinite(parsed) || parsed < field.min || parsed > field.max);
          return (
            <label key={field.key} className={bad ? "measure-field is-bad" : "measure-field"}>
              <span className="measure-field-label">{field.label}</span>
              <span className="measure-field-input">
                <input
                  type="number"
                  inputMode="decimal"
                  step={field.step ?? "1"}
                  min={field.min}
                  max={field.max}
                  value={values[field.key] ?? ""}
                  disabled={submitting}
                  aria-label={`${field.label} (${field.unit})`}
                  aria-invalid={bad || undefined}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                />
                <span className="measure-field-unit">{field.unit}</span>
              </span>
              {bad ? (
                <span className="measure-field-hint">
                  {field.min}~{field.max} 사이로 넣어 주세요
                </span>
              ) : null}
            </label>
          );
        })}
      </div>

      <div className="measure-actions">
        <button type="submit" className="primary-button" disabled={!canSubmit}>
          {submitting ? "기록하는 중…" : "측정값 제출"}
        </button>
        {touched && entered.length === 0 ? (
          <span className="measure-field-hint">한 칸이라도 넣어 주세요.</span>
        ) : (
          <span className="challenge-dim">
            제출하면 이 항목이 자동으로 체크됩니다. 값은 이 기기에만 남습니다.
          </span>
        )}
      </div>
    </form>
  );
}
