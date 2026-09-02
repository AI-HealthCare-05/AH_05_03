/**
 * 건강 현황 — 챌린지와 수치를 한 화면에 모은다.
 *
 * 왜 모았나
 * ---------
 * 가족 홈은 **관리**하는 곳이다(구성원 추가, 기록 작성, 검진표 올리기, 가족력).
 * 그런데 챌린지는 `/challenge/today` 에, 수치 추이는 판정을 한 번 돌려야만 보이는
 * 판정 화면 밑바닥에 있었다. 둘 다 "지금 어떤가"를 묻는 화면인데 들어가는 문이
 * 서로 멀었다.
 *
 * 왜 세로로 쌓았나
 * ----------------
 * 탭으로 가르면 한 번에 하나만 보인다. 오늘 물을 줬는지와 이번 달 혈압이 내렸는지는
 * 같이 봐야 뜻이 생긴다 — 행동과 결과라서.
 *
 * 여기서는 아무것도 새로 계산하지 않는다. 챌린지는 서버 큐를, 추이는 기기 안 스냅샷을
 * 그대로 읽는다.
 */

import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";

import { useLocalDomain } from "../../app/localDomainContext";
import { DISEASE_NAMES, LEVEL_LABEL, type RiskLevel } from "../assessment/contracts";
import {
  buildLevelTracks,
  buildSeries,
  listSnapshots,
  type Snapshot,
  summarizeLatest,
  TREND_WINDOW,
} from "../assessment/snapshots";
import { TrendChart } from "../assessment/TrendChart";
import { ChallengeDashboardCard } from "../challenge/ChallengeDashboardCard";

export function InsightsPage() {
  const { runtime, profiles } = useLocalDomain();
  const [profileId, setProfileId] = useState<string>();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  // 어느 구성원의 스냅샷을 들고 있는지. 별도 `loading` 깃발을 두면 effect 안에서
  // 동기로 setState 를 부르게 되고, 그건 연쇄 렌더를 만든다
  // (`react-hooks/set-state-in-effect`). 실려 있는 사람과 보고 있는 사람이
  // 다르면 아직 불러오는 중이다 — 깃발 하나가 덜 필요하다.
  const [loadedFor, setLoadedFor] = useState<string>();

  const activeProfileId = profileId ?? profiles[0]?.id;
  const activeProfile = profiles.find((item) => item.id === activeProfileId);

  // 취소 깃발을 두는 이유는 판정 화면과 같다 — 구성원을 빠르게 바꾸면 먼저 띄운
  // 조회가 늦게 돌아와 다른 사람의 그래프를 덮는다.
  useEffect(() => {
    if (!runtime || !activeProfileId) return;
    let cancelled = false;
    void listSnapshots(runtime, activeProfileId).then((found) => {
      if (cancelled) return;
      setSnapshots(found);
      setLoadedFor(activeProfileId);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, activeProfileId]);

  const loading = Boolean(activeProfileId) && loadedFor !== activeProfileId;

  const recent = useMemo(() => snapshots.slice(-TREND_WINDOW), [snapshots]);
  const series = useMemo(() => buildSeries(recent), [recent]);
  const tracks = useMemo(() => buildLevelTracks(recent), [recent]);
  const latest = useMemo(() => summarizeLatest(snapshots), [snapshots]);

  return (
    <div className="product-page insights-page">
      <section className="dashboard-heading">
        <div>
          <p className="page-kicker">건강 현황</p>
          <h1>오늘 한 일과 그동안의 수치</h1>
          <p>챌린지 진행과 검사 수치 변화를 한 화면에서 봅니다. 모두 이 기기에 저장된 값입니다.</p>
        </div>
        {profiles.length > 1 ? (
          <label className="insights-picker">
            <span>구성원</span>
            <select value={activeProfileId ?? ""} onChange={(event) => setProfileId(event.target.value)}>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      <ChallengeDashboardCard />

      <section className="dashboard-section" aria-labelledby="insights-numbers-heading">
        <div className="section-title-row">
          <div>
            <p className="section-kicker">수치</p>
            <h2 id="insights-numbers-heading">
              {activeProfile ? `${activeProfile.displayName}님의 검사 수치와 판정` : "검사 수치와 판정"}
            </h2>
          </div>
          {latest ? (
            <span className="section-count">
              최근 판정 {LEVEL_LABEL[latest.highestLevel as RiskLevel] ?? latest.highestLevel} · 주의{" "}
              {latest.needsAttention}개
            </span>
          ) : null}
        </div>

        {profiles.length === 0 ? (
          <div className="compact-empty">
            <strong>먼저 가족 구성원을 등록해 주세요.</strong>
            <p>
              <NavLink to="/">가족 홈</NavLink>에서 구성원을 만들면 그 사람의 수치를 여기에 모읍니다.
            </p>
          </div>
        ) : loading ? (
          <div className="compact-empty">
            <strong>불러오는 중…</strong>
          </div>
        ) : snapshots.length === 0 ? (
          <div className="compact-empty">
            <strong>아직 판정 기록이 없어요.</strong>
            <p>
              <NavLink to="/">가족 홈</NavLink>에서 검진표를 올리거나 수치를 직접 넣어 판정하면 여기에 쌓입니다.
            </p>
          </div>
        ) : series.length === 0 && tracks.length === 0 ? (
          <div className="compact-empty">
            {/* 한 점짜리 계열은 `buildSeries` 가 걸러 낸다. 선 없는 축만 남으면
                사용자는 고장으로 읽는다 — 왜 비었는지를 대신 적는다. */}
            <strong>판정이 한 번뿐이라 아직 선을 그릴 수 없어요.</strong>
            <p>두 번째 판정부터 변화가 그려집니다.</p>
          </div>
        ) : (
          <>
            <p className="assess-muted">
              <strong>입력한 수치 자체</strong>와 <strong>등급의 변화</strong>를 겹칩니다. 등급은 그날 계산한 값을
              그대로 남긴 것입니다 — 나중에 재채점하면 그날 본 화면과 달라집니다.
            </p>
            <TrendChart
              series={series}
              tracks={tracks}
              names={DISEASE_NAMES}
              dates={recent.map((snapshot) => snapshot.recordedAt)}
              total={snapshots.length}
            />
          </>
        )}
      </section>
    </div>
  );
}
