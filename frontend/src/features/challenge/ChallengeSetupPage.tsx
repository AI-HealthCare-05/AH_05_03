/**
 * 챌린지 첫 화면 — 모드와 이번 주 목표를 고른다.
 *
 * 목표를 앱이 정해 주면 과제가 되고 사용자가 고르면 계획이 된다. 그래서 주 완주
 * 기준(3·5·7일)과 재는 날을 본인이 고르게 했다. 낮추면 흔들림이 줄고 올리면 점수가
 * 는다 — 어느 쪽도 벌이 아니다.
 *
 * 한 번 고르면 `configured` 가 서고 다음부터는 본 화면으로 바로 간다.
 */

import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import type { ChallengeMode } from "./contracts";
import { useChallengeSettingsQuery, useSaveSettingsMutation } from "./queries";
import { ServerApiError } from "../../shared/api/serverApiClient";

const GOALS = [
  { days: 3, label: "느슨하게", detail: "주 3일이면 완주. 시작하거나 바쁠 때" },
  { days: 5, label: "기본", detail: "주 5일이면 완주. 하루 이틀 빠져도 괜찮다" },
  { days: 7, label: "빡세게", detail: "매일. 점수가 가장 빨리 는다" },
] as const;

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;

export function ChallengeSetupPage() {
  const settingsQuery = useChallengeSettingsQuery();
  const save = useSaveSettingsMutation();
  const navigate = useNavigate();

  const [mode, setMode] = useState<ChallengeMode>("personal");
  const [goal, setGoal] = useState(5);
  const [weekday, setWeekday] = useState(6);

  const loadError = settingsQuery.error;
  if (loadError) {
    return (
      <main className="challenge-page">
        <h1>챌린지</h1>
        <p className="challenge-empty">
          {loadError instanceof ServerApiError && loadError.status === 401
            ? "로그인하면 챌린지를 시작할 수 있습니다."
            : "챌린지를 불러오지 못했습니다."}
        </p>
      </main>
    );
  }

  if (!settingsQuery.data) {
    return (
      <main className="challenge-page">
        <h1>챌린지</h1>
        <p className="challenge-empty">불러오는 중…</p>
      </main>
    );
  }

  // 이미 고른 적이 있으면 셋업을 건너뛴다. 설정을 바꾸려면 본 화면에서 다시 온다.
  if (settingsQuery.data.configured && !settingsQuery.isRefetching) {
    return <Navigate to="/challenge/today" replace />;
  }

  return (
    <main className="challenge-page challenge-setup">
      <header className="challenge-head">
        <h1>어떻게 시작할까요?</h1>
        <p className="challenge-sub">나중에 언제든 바꿀 수 있습니다.</p>
      </header>

      <section aria-labelledby="mode-heading">
        <h2 id="mode-heading">누구와 하나요</h2>
        <div className="setup-cards">
          <button
            type="button"
            className={mode === "personal" ? "setup-card is-picked" : "setup-card"}
            aria-pressed={mode === "personal"}
            onClick={() => setMode("personal")}
          >
            <span className="setup-card-title">개인 챌린지</span>
            <span className="challenge-dim">
              내 나무만 키웁니다. 혼자서도 전부 동작합니다.
            </span>
          </button>
          <button
            type="button"
            className={mode === "family" ? "setup-card is-picked" : "setup-card"}
            aria-pressed={mode === "family"}
            onClick={() => setMode("family")}
          >
            <span className="setup-card-title">가족 챌린지</span>
            <span className="challenge-dim">
              하는 항목은 같습니다. 여기에 <strong>집 공동 목표</strong>와 나란한 나무가 얹힙니다.
            </span>
          </button>
        </div>
      </section>

      <section aria-labelledby="goal-heading">
        <h2 id="goal-heading">이번 주 목표</h2>
        <ul className="setup-goals">
          {GOALS.map((item) => (
            <li key={item.days}>
              <label className={goal === item.days ? "is-picked" : undefined}>
                <input
                  type="radio"
                  name="weekly-goal"
                  checked={goal === item.days}
                  onChange={() => setGoal(item.days)}
                />
                <span className="setup-goal-title">
                  {item.label} · 주 {item.days}일 물주기
                </span>
                <span className="challenge-dim">{item.detail}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="challenge-dim">
          {/* 측정이 주 완주의 관문이라는 규칙은 목표와 무관하게 그대로다. */}
          목표와 별개로, 그 주에 한 번은 재야 주가 마감됩니다.
        </p>
      </section>

      <section aria-labelledby="weekday-heading">
        <h2 id="weekday-heading">재는 날</h2>
        <p className="challenge-dim">
          가족이 같은 날 재면 그 주의 비교가 같은 시점에 일어납니다.
        </p>
        <div className="setup-weekdays" role="group" aria-label="재는 요일">
          {WEEKDAYS.map((name, index) => (
            <button
              key={name}
              type="button"
              className={weekday === index ? "setup-weekday is-picked" : "setup-weekday"}
              aria-pressed={weekday === index}
              onClick={() => setWeekday(index)}
            >
              {name}
            </button>
          ))}
        </div>
      </section>

      {save.isError ? (
        <p className="challenge-error">설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
      ) : null}

      <button
        type="button"
        className="primary-button setup-submit"
        disabled={save.isPending}
        onClick={() =>
          save.mutate(
            { mode, weekly_water_goal: goal, measure_weekday: weekday },
            { onSuccess: () => navigate("/challenge/today") },
          )
        }
      >
        {save.isPending ? "저장하는 중…" : "시작하기"}
      </button>
    </main>
  );
}
