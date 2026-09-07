/**
 * 가족 홈 대시보드에 얹는 챌린지 요약. 전체 화면은 `/challenge` 에 있다.
 *
 * 자체 완결이라 `HomePage` 는 이 컴포넌트를 한 줄 끼우기만 한다. 로그인 전이거나
 * 서버가 안 붙으면 **아무것도 그리지 않는다** — 대시보드는 로컬 우선 화면이라
 * 서버가 없어도 나머지가 그대로 동작해야 하고, 여기서 오류 배너를 띄우면 로그인
 * 안 한 사용자에게 매번 빨간 줄이 뜬다.
 */

import { NavLink } from "react-router-dom";

import { Tree } from "./GardenArt";
import { useChallengeTodayQuery } from "./queries";

export function ChallengeDashboardCard() {
  const { data, isError } = useChallengeTodayQuery();

  if (isError || !data || !data.garden || !Array.isArray(data.garden.animals)) return null;

  const { garden } = data;
  const animals = garden.animals.filter((animal) => animal.earned);
  const remaining = data.water_requirement - data.checked_count;

  return (
    <section className="dashboard-section challenge-card" aria-labelledby="challenge-card-heading">
      <div className="section-title-row">
        <div>
          <p className="section-kicker">생활습관 챌린지</p>
          <h2 id="challenge-card-heading">
            {data.watered_today ? "오늘 물을 주었습니다" : "오늘 아직 물을 안 줬어요"}
          </h2>
        </div>
        <NavLink className="primary-button" to="/challenge">
          챌린지 열기
        </NavLink>
      </div>

      <div className="challenge-card-body">
        <Tree
          stage={garden.tree.key}
          animals={animals.map((animal) => animal.id)}
          size={124}
          label={`${garden.tree.label}, 동물 ${animals.length}마리`}
        />
        <div className="challenge-card-facts">
          <p className="challenge-card-lead">
            {data.watered_today
              ? `이번 주 물 ${garden.week.water_days}/${garden.week.water_required}일`
              : remaining === 1
                ? "하나만 더 하면 오늘 물을 줍니다."
                : `${remaining}개 더 하면 오늘 물을 줍니다.`}
          </p>
          <p className="challenge-dim">
            {garden.tree.label} · {garden.total_points.toLocaleString()}점 · 흙 {garden.nutrition.label}
            {garden.nutrition.current_streak > 0 ? ` · ${garden.nutrition.current_streak}주 연속` : null}
          </p>
          <p className="challenge-dim">
            {garden.week.measure_count >= garden.week.measure_required
              ? "이번 주 측정은 마쳤습니다."
              : "이번 주에 하나라도 재면 주가 마감됩니다."}
          </p>
        </div>
      </div>
    </section>
  );
}
