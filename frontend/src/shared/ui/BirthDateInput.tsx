import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

interface BirthDateInputProps {
  defaultValue?: string;
  name?: string;
}

export function BirthDateInput({ defaultValue = "", name = "birthDate" }: BirthDateInputProps) {
  const [initialYear = "", initialMonth = "", initialDay = ""] = defaultValue.split("-");
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [day, setDay] = useState(initialDay);
  const monthRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const nativeDateRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const hasAnyValue = Boolean(year || month || day);
  const completeValue = year.length === 4 && month.length === 2 && day.length === 2
    ? `${year}-${month}-${day}`
    : "";

  useEffect(() => {
    dayRef.current?.setCustomValidity(
      completeValue && !isValidDate(completeValue) ? "올바른 생년월일을 입력해 주세요." : "",
    );
  }, [completeValue]);

  return (
    <fieldset className="birth-date-field">
      <legend id={labelId}>
        생년월일
      </legend>
      <div className="birth-date-input" role="group" aria-labelledby={labelId}>
        <input
          aria-label="생년월일 연도"
          autoComplete="bday-year"
          inputMode="numeric"
          maxLength={4}
          pattern="[0-9]{4}"
          placeholder="YYYY"
          required={hasAnyValue}
          value={year}
          onChange={(event) => {
            const value = digits(event.currentTarget.value, 4);
            setYear(value);
            if (value.length === 4) monthRef.current?.focus();
          }}
        />
        <span aria-hidden="true">년</span>
        <input
          ref={monthRef}
          aria-label="생년월일 월"
          autoComplete="bday-month"
          inputMode="numeric"
          maxLength={2}
          pattern="0[1-9]|1[0-2]"
          placeholder="MM"
          required={hasAnyValue}
          value={month}
          onBlur={(event) => {
            const value = digits(event.currentTarget.value, 2);
            if (value.length === 1) setMonth(value.padStart(2, "0"));
          }}
          onChange={(event) => {
            const value = digits(event.currentTarget.value, 2);
            setMonth(value);
            if (value.length === 2) dayRef.current?.focus();
          }}
          onKeyDown={(event) => focusPreviousWhenEmpty(event, year)}
        />
        <span aria-hidden="true">월</span>
        <input
          ref={dayRef}
          aria-label="생년월일 일"
          autoComplete="bday-day"
          inputMode="numeric"
          maxLength={2}
          pattern="0[1-9]|[12][0-9]|3[01]"
          placeholder="DD"
          required={hasAnyValue}
          value={day}
          onBlur={(event) => {
            const value = digits(event.currentTarget.value, 2);
            if (value.length === 1) setDay(value.padStart(2, "0"));
          }}
          onChange={(event) => setDay(digits(event.currentTarget.value, 2))}
          onKeyDown={(event) => focusPreviousWhenEmpty(event, month)}
        />
        <span aria-hidden="true">일</span>
        <input
          ref={nativeDateRef}
          className="birth-date-native"
          name={name}
          type="date"
          tabIndex={-1}
          value={completeValue && isValidDate(completeValue) ? completeValue : ""}
          onChange={(event) => {
            const [nextYear = "", nextMonth = "", nextDay = ""] = event.currentTarget.value.split("-");
            setYear(nextYear);
            setMonth(nextMonth);
            setDay(nextDay);
          }}
        />
        <button
          className="birth-date-calendar"
          type="button"
          aria-label="달력에서 생년월일 선택"
          onClick={() => {
            if (typeof nativeDateRef.current?.showPicker === "function") {
              nativeDateRef.current.showPicker();
            } else {
              nativeDateRef.current?.click();
            }
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 2v3m10-3v3M4 9h16M5 4h14a1 1 0 0 1 1 1v15H4V5a1 1 0 0 1 1-1Z" />
          </svg>
        </button>
      </div>
    </fieldset>
  );
}

function digits(value: string, maxLength: number): string {
  return value.replace(/\D/gu, "").slice(0, maxLength);
}

function focusPreviousWhenEmpty(event: KeyboardEvent<HTMLInputElement>, previousValue: string): void {
  if (event.key === "Backspace" && event.currentTarget.value === "") {
    const previousInput = event.currentTarget.previousElementSibling?.previousElementSibling;
    if (previousInput instanceof HTMLInputElement) {
      previousInput.focus();
      previousInput.setSelectionRange(previousValue.length, previousValue.length);
    }
  }
}

function isValidDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
