/**
 * 생활습관 챌린지 화면. Talos 필수 셋 중 마지막으로 비어 있던 칸이다.
 *
 * 화면이 지켜야 하는 것 셋 (docs/37 §14~§16 에서 팀이 정했다).
 *
 * 1. 점수·순위 어디에도 건강 수치가 안 나온다. 서버가 애초에 안 보내 준다.
 * 2. 물주기는 하루 4종을 **전부** 채웠을 때만 일어난다. 부분 달성도 점수는 들어간다.
 * 3. 안 하면 시들지 않는다. 그냥 안 자란다. 벌칙 문구를 쓰지 않는다.
 */

import { useCallback, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";

import { AnimalBadge, Tree } from "./GardenArt";
import { MeasureForm } from "./MeasureForm";
import { saveMeasurement } from "./measurements";
import { useLocalDomain } from "../../app/localDomainContext";
import { WeekCalendar } from "./WeekCalendar";
import type { AnimalId, ChallengeToday } from "./contracts";
import { useChallengeTodayQuery, useHouseholdGardenQuery, useToggleCheckMutation } from "./queries";
import { ServerApiError } from "../../shared/api/serverApiClient";

function earnedIds(today: ChallengeToday | null | undefined): AnimalId[] {
  return (today?.garden?.animals ?? []).filter((animal) => animal.earned).map((animal) => animal.id);
}

export function ChallengePage() {
  const todayQuery = useChallengeTodayQuery();
  const householdQuery = useHouseholdGardenQuery();
  const toggleCheck = useToggleCheckMutation();
  const { runtime, profiles } = useLocalDomain();
  const [measuring, setMeasuring] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [celebrate, setCelebrate] = useState<{ watered: boolean; animals: AnimalId[] } | null>(null);

  const today = todayQuery.data;
  const household = householdQuery.data ?? null;
  // 진행 중인 항목만 잠그면 **서로 다른 항목을 연타할 때** 응답 순서가 뒤집힐 수 있다.
  // 늦게 도착한 응답이 먼저 계산된 정원으로 캐시를 덮어 점수가 한 칸 뒤처진다.
  // 체크 한 번이 13 ms 라 전부 잠가도 눈에 안 띄고, 대신 순서가 보장된다.
  const busy = toggleCheck.isPending;

  const toggle = useCallback(
    (challengeId: string, checked: boolean) => {
      toggleCheck.mutate(
        { challengeId, checked },
        {
          onSuccess: (result) => {
            if (result.watered_now || result.new_animals.length > 0) {
              setCelebrate({
                watered: result.watered_now,
                animals: result.new_animals.map((animal) => animal.id),
              });
            }
          },
        },
      );
    },
    [toggleCheck],
  );

  /**
   * 측정 제출 — 값은 로컬, 사실은 서버.
   *
   * 로컬 저장이 먼저다. 서버 체크만 되고 값이 안 남으면 "쟀다고 표시는 됐는데 수치가
   * 없는" 상태가 되고, 그건 사용자가 고칠 방법이 없다. 반대 순서면 값이 남고 체크만
   * 빠지므로 다시 누르면 된다.
   */
  const submitMeasurement = useCallback(
    async (challengeId: string, values: Record<string, number>) => {
      setMeasuring(challengeId);
      setSaveFailed(false);
      try {
        const profileId = profiles[0]?.id;
        if (runtime && profileId) {
          await saveMeasurement(runtime, profileId, challengeId, values);
        } else {
          // 보관함이 아직 안 열렸으면 값을 남길 데가 없다. 체크만 올리고 사실을 알린다.
          setSaveFailed(true);
        }
        toggleCheck.mutate(
          { challengeId, checked: false },
          {
            onSuccess: (result) => {
              if (result.watered_now || result.new_animals.length > 0) {
                setCelebrate({
                  watered: result.watered_now,
                  animals: result.new_animals.map((animal) => animal.id),
                });
              }
            },
          },
        );
      } catch {
        setSaveFailed(true);
      } finally {
        setMeasuring(null);
      }
    },
    [profiles, runtime, toggleCheck],
  );

  const animals = useMemo(() => earnedIds(today), [today]);

  // 세션이 끊기면 화면은 캐시로 멀쩡해 보이는데 클릭만 조용히 실패한다. 실제로
  // 그렇게 새어 나갔다 — 사용자는 "눌러도 아무 일이 없다" 고 느낀다. 만료는 맨 위에서
  // 눈에 띄게 말하고 다시 로그인할 곳으로 보낸다.
  const sessionExpired =
    toggleCheck.error instanceof ServerApiError && toggleCheck.error.status === 401;

  const loadError = todayQuery.error;
  if (loadError && !today) {
    return (
      <main className="challenge-page">
        <h1>챌린지</h1>
        <p className="challenge-empty">
          {loadError instanceof ServerApiError && loadError.status === 401
            ? "로그인하면 오늘의 챌린지가 보입니다."
            : "챌린지를 불러오지 못했습니다."}
        </p>
      </main>
    );
  }

  if (!today) {
    return (
      <main className="challenge-page">
        <h1>챌린지</h1>
        <p className="challenge-empty">불러오는 중…</p>
      </main>
    );
  }

  const { garden } = today;
  const remaining = today.water_requirement - today.checked_count;

  return (
    <main className="challenge-page">
      <header className="challenge-head">
        <h1>오늘의 챌린지</h1>
        <p className="challenge-sub">
          {today.watered_today
            ? "오늘 물을 주었습니다."
            : remaining === 1
              ? "하나만 더 하면 오늘 물을 줍니다."
              : `${remaining}개 더 하면 오늘 물을 줍니다.`}
        </p>
      </header>

      {sessionExpired ? (
        <div className="challenge-banner" role="alert">
          <div>
            <strong>로그인이 만료됐습니다.</strong>
            <p>다시 로그인하면 방금 누른 체크부터 이어서 기록됩니다.</p>
          </div>
          <NavLink className="primary-button" to="/account">
            로그인하러 가기
          </NavLink>
        </div>
      ) : null}

      {celebrate ? (
        <div className="challenge-toast" role="status">
          {celebrate.watered ? "물을 주었습니다. " : null}
          {celebrate.animals.length > 0
            ? `${celebrate.animals
                .map((id) => garden.animals.find((animal) => animal.id === id)?.name ?? id)
                .join(" · ")}가 찾아왔습니다.`
            : null}
          <button type="button" onClick={() => setCelebrate(null)} aria-label="닫기">
            닫기
          </button>
        </div>
      ) : null}

      <section className="challenge-garden" aria-labelledby="garden-heading">
        <h2 id="garden-heading">내 나무</h2>
        <div className="challenge-garden-body">
          <Tree
            stage={garden.tree.key}
            animals={animals}
            justWatered={celebrate?.watered ?? false}
            size={220}
            label={`${garden.tree.label}, 동물 ${animals.length}마리`}
          />
          <dl className="challenge-stats">
            <div>
              <dt>단계</dt>
              <dd>
                {garden.tree.label}
                <span className="challenge-dim">
                  {" "}
                  ({garden.tree.index + 1}/{garden.tree.total})
                </span>
              </dd>
            </div>
            <div>
              <dt>점수</dt>
              <dd>{garden.total_points.toLocaleString()}점</dd>
            </div>
            <div>
              <dt>흙</dt>
              <dd>
                {garden.nutrition.label}
                <span className="challenge-dim"> ×{garden.nutrition.multiplier}</span>
              </dd>
            </div>
            <div>
              <dt>연속</dt>
              <dd>
                {garden.nutrition.current_streak}주
                {garden.nutrition.max_streak > garden.nutrition.current_streak ? (
                  <span className="challenge-dim"> (최고 {garden.nutrition.max_streak}주)</span>
                ) : null}
              </dd>
            </div>
          </dl>
        </div>
        {garden.tree.next_label ? (
          <p className="challenge-next">
            {garden.tree.points_to_next}점 더 모으면 {garden.tree.next_label}
          </p>
        ) : (
          <p className="challenge-next">마지막 단계입니다.</p>
        )}
      </section>

      <section className="challenge-week" aria-labelledby="week-heading">
        <h2 id="week-heading">이번 주</h2>
        <p>
          물 {garden.week.water_days}/{garden.week.water_required}일 · 측정{" "}
          {garden.week.measure_count}/{garden.week.measure_required}회
          {garden.week.completed ? " · 완주" : ` · ${garden.week.days_left}일 남음`}
        </p>
        <WeekCalendar days={garden.week.days} />
        <p className="challenge-dim">
          {/* 측정이 주 완주의 관문이다. 물만 주고 한 번도 안 재는 사용자가 생기면 안 된다. */}
          {garden.week.measure_count >= garden.week.measure_required
            ? "이번 주 측정은 마쳤습니다."
            : "이번 주에 하나라도 재면 주가 마감되고 흙이 좋아집니다."}
        </p>
      </section>

      <section className="challenge-list" aria-labelledby="daily-heading">
        <h2 id="daily-heading">매일</h2>
        <ul>
          {today.daily.map((item) => (
            <li key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={item.checked}
                  disabled={busy}
                  onChange={() => toggle(item.id, item.checked)}
                />
                <span className="challenge-item-title">{item.title}</span>
                <span className="challenge-dim">{item.detail}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="challenge-list challenge-measures" aria-labelledby="measure-heading">
        <h2 id="measure-heading">측정하기</h2>
        <ul>
          {today.measures.map((item) => (
            <li key={item.id} className={item.checked_this_week ? "is-done" : undefined}>
              <label>
                <input
                  type="checkbox"
                  checked={item.checked_this_week}
                  disabled={busy || measuring !== null}
                  onChange={() => toggle(item.id, item.checked_this_week)}
                />
                <span className="challenge-item-title">{item.title}</span>
                <span className="challenge-dim">
                  {item.detail}
                  {item.opens.length > 1 ? ` · 판정 ${item.opens.length}칸이 열립니다` : null}
                </span>
              </label>
              {item.checked_this_week ? (
                <p className="challenge-dim measure-done">이번 주 기록했습니다.</p>
              ) : (
                <MeasureForm
                  item={item}
                  submitting={measuring === item.id}
                  onSubmit={(values) => void submitMeasurement(item.id, values)}
                />
              )}
            </li>
          ))}
        </ul>
        {saveFailed ? (
          <p className="challenge-error">
            체크는 올렸지만 이 기기에 값을 남기지 못했습니다. 보관함을 연 뒤 다시 넣어 주세요.
          </p>
        ) : null}
        <p className="challenge-dim">
          값은 이 기기에만 남습니다. 서버는 쟀다는 사실과 날짜만 압니다.
        </p>
      </section>

      <section className="challenge-animals" aria-labelledby="animals-heading">
        <h2 id="animals-heading">
          찾아온 동물 <span className="challenge-dim">{animals.length}/{garden.animals.length}</span>
        </h2>
        <ul>
          {garden.animals.map((animal) => (
            <li key={animal.id} className={animal.earned ? "is-earned" : undefined}>
              <AnimalBadge animal={animal.id} earned={animal.earned} />
              <span className="challenge-item-title">{animal.name}</span>
              <span className="challenge-dim">{animal.hint}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 리더보드는 **항상 보인다.** 2명 이상일 때만 그렸더니 혼자 쓰는 사람에게는
          기능이 있다는 사실조차 안 보였다. 혼자여도 자기 줄을 보여 주고 초대로 잇는다. */}
      <section className="challenge-family" aria-labelledby="family-heading">
        <h2 id="family-heading">우리 집 리더보드</h2>

        {!household ? (
          <div className="challenge-invite">
            <p>아직 가정이 없습니다. 가족을 초대하면 나무를 나란히 놓고 함께 볼 수 있습니다.</p>
            <NavLink className="primary-button" to="/account">
              가정 만들고 초대하기
            </NavLink>
          </div>
        ) : (
        <>
          <p>
            이번 주 {household.members_total}명 중 {household.members_completed}명이 완주했습니다.
          </p>
          {/* 집 공동 목표 = 구성원 각자 목표의 합. 개인 항목은 그대로 두고 그 위에 얹는다. */}
          <div className={household.goal.reached ? "household-goal is-reached" : "household-goal"}>
            <div className="household-goal-head">
              <span className="challenge-item-title">
                우리 집 이번 주 물주기 {household.goal.done_days} / {household.goal.goal_days}일
              </span>
              {household.goal.reached ? <span className="household-goal-badge">달성</span> : null}
            </div>
            <div
              className="household-goal-bar"
              role="img"
              aria-label={`집 공동 목표 ${household.goal.goal_days}일 중 ${household.goal.done_days}일 달성`}
            >
              <span
                style={{
                  width: `${Math.min(100, Math.round((household.goal.done_days / Math.max(1, household.goal.goal_days)) * 100))}%`,
                }}
              />
            </div>
          </div>
          <ol className="challenge-rank">
            {household.items.map((member) => (
              <li key={member.account_id} className={member.is_me ? "is-me" : undefined}>
                <Tree stage={member.tree_key} size={72} label={`${member.tree_label}`} />
                <div>
                  <span className="challenge-item-title">
                    {member.rank}. {member.is_me ? "나" : member.masked_email}
                  </span>
                  <span className="challenge-dim">
                    {member.season_points.toLocaleString()}점 · {member.tree_label} · 동물{" "}
                    {member.animal_count}마리
                    {member.week_completed ? " · 이번 주 완주" : null}
                  </span>
                </div>
              </li>
            ))}
          </ol>
          {household.items.length < 2 ? (
            <div className="challenge-invite">
              <p>아직 혼자입니다. 가족이 들어오면 나무가 나란히 놓입니다.</p>
              <NavLink className="primary-button" to="/account">
                가족 초대하기
              </NavLink>
            </div>
          ) : null}
          <p className="challenge-dim">
            순위는 이번 시즌 점수로 매깁니다. 나무 크기는 누적이라 줄어들지 않습니다.
          </p>
        </>
        )}
      </section>

      {toggleCheck.isError && !sessionExpired ? (
        <p className="challenge-error">체크를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
      ) : null}
    </main>
  );
}
