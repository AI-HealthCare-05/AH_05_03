/**
 * 주간 달력. 월~일 일곱 칸을 상태별로 칠한다.
 *
 * 색이 넷이라 색만으로 뜻을 전달하지 않도록 칸마다 `aria-label` 에 말로도 적는다
 * (DESIGN.md §접근성 — 주 사용자가 30~60대이고 상당수가 노안·저시력이다).
 *
 * "아직 오지 않은 날" 과 "못 한 날" 을 갈라 칠하는 것이 중요하다. 목요일에 금·토·일이
 * 빨갛게 보이면 아직 하지도 않은 날을 실패로 세는 셈이 된다.
 */

import type { WeekDay } from "./contracts";

const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

type DayState = "done" | "missed" | "today" | "future" | "partial";

function stateOf(day: WeekDay): DayState {
  if (day.watered) return "done";
  if (day.is_today) return "today";
  if (day.is_future) return "future";
  return day.checked_count > 0 ? "partial" : "missed";
}

const STATE_TEXT: Record<DayState, string> = {
  done: "물을 준 날",
  missed: "못 한 날",
  today: "오늘",
  future: "아직 오지 않은 날",
  partial: "일부만 한 날",
};

export function WeekCalendar({ days }: { days: WeekDay[] }) {
  return (
    <ol className="week-calendar" aria-label="이번 주 달력">
      {days.map((day) => {
        const state = stateOf(day);
        const dayNumber = Number(day.date.slice(8, 10));
        return (
          <li
            key={day.date}
            className={`week-day is-${state}${day.is_today ? " is-cursor" : ""}`}
            aria-label={`${WEEKDAY_LABELS[day.weekday]}요일 ${dayNumber}일, ${STATE_TEXT[state]}, ${day.checked_count}/${day.total_count} 완료${day.measured ? ", 측정함" : ""}`}
          >
            <span className="week-day-name">{WEEKDAY_LABELS[day.weekday]}</span>
            <span className="week-day-date">{dayNumber}</span>
            <span className="week-day-dots" aria-hidden="true">
              {Array.from({ length: day.total_count }).map((_, index) => (
                <i key={index} className={index < day.checked_count ? "is-on" : undefined} />
              ))}
            </span>
            {day.measured ? (
              <span className="week-day-measured" aria-hidden="true" title="측정한 날">
                ◆
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
