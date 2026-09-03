/**
 * 추적 대시보드 차트 — SVG 직접 그린다.
 *
 * 왜 차트 라이브러리를 안 넣었나
 * ------------------------------
 * 셋을 놓고 봤다. 하나, `package.json` 에 차트 라이브러리가 하나도 없고 번들은 이미
 * 500 kB 경고를 받고 있다. 둘, 그릴 것이 작다 — 점 몇 개짜리 선 여러 개다. 셋이
 * 결정적이다 — **여기서 정작 중요한 그림이 라이브러리가 잘 못 하는 종류다.** 등급은
 * 수치가 아니라 순서 있는 범주(NORMAL→CAUTION→HIGH)이고, 그 위에 "정본 엔진이 바뀐
 * 시점"이라는 표를 세워야 한다. 그건 어느 라이브러리도 기본으로 주지 않는다.
 *
 * 나중에 라이브러리로 옮길 여지는 남겼다 — 계열 계산은 `snapshots.ts` 가 하고 이
 * 파일은 그리기만 한다.
 */

import type { LevelTrack, TrendSeries } from "./snapshots";
import { LEVEL_LABEL, type RiskLevel } from "./contracts";

const W = 280;
const H = 84;
const PAD = { top: 10, right: 8, bottom: 18, left: 8 };

function formatDay(iso: string): string {
  return iso.slice(2, 10).replace(/-/g, ".");
}

function Sparkline({ series }: { series: TrendSeries }) {
  const values = series.points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // 값이 전부 같으면 폭이 0 이라 나누기가 깨진다. 그때는 가운데 수평선을 그린다.
  const span = max - min || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = series.points.length > 1 ? innerW / (series.points.length - 1) : 0;

  const coords = series.points.map((point, index) => {
    const x = PAD.left + step * index;
    const y = PAD.top + innerH - ((point.value - min) / span) * innerH;
    return { x, y, ...point };
  });
  const path = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

  const first = values[0];
  const last = values[values.length - 1];
  const delta = last - first;
  const direction = delta > 0 ? "올랐다" : delta < 0 ? "내렸다" : "그대로다";

  return (
    <figure className="trend-card">
      <figcaption>
        <span className="trend-label">{series.label}</span>
        <span className="trend-latest">
          {last}
          <span className="assess-muted"> {series.unit}</span>
        </span>
        <span className={`trend-delta ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}`}>
          {delta === 0 ? "변화 없음" : `${delta > 0 ? "+" : ""}${Number(delta.toFixed(1))}`}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${series.label} ${series.points.length}개 시점. ${formatDay(series.points[0].at)} ${first}${series.unit} 에서 ${formatDay(series.points[series.points.length - 1].at)} ${last}${series.unit} 로 ${direction}.`}
      >
        <polyline className="trend-line" points={path} fill="none" />
        {coords.map((c) => (
          <circle key={c.at} className="trend-dot" cx={c.x} cy={c.y} r="2.5" />
        ))}
        <text className="trend-axis" x={PAD.left} y={H - 4}>
          {formatDay(series.points[0].at)}
        </text>
        <text className="trend-axis" x={W - PAD.right} y={H - 4} textAnchor="end">
          {formatDay(series.points[series.points.length - 1].at)}
        </text>
      </svg>
    </figure>
  );
}

const LEVEL_CLASS: Record<string, string> = {
  VERY_HIGH: "level-very-high",
  HIGH: "level-high",
  CAUTION: "level-caution",
  NORMAL: "level-normal",
  INSUFFICIENT_DATA: "level-unknown",
};

function LevelRow({ track, names }: { track: LevelTrack; names: Record<string, string> }) {
  return (
    <li className="trend-track">
      <span className="trend-track-name">{names[track.key] ?? track.key}</span>
      <ol className="trend-track-cells">
        {track.levels.map((level, index) => (
          <li
            key={index}
            className={`trend-cell ${LEVEL_CLASS[level ?? "INSUFFICIENT_DATA"]}`}
            title={LEVEL_LABEL[(level ?? "INSUFFICIENT_DATA") as RiskLevel]}
          >
            {track.engineChanges.includes(index) && (
              <span className="trend-engine-flag" aria-hidden="true">
                ▲
              </span>
            )}
            <span className="trend-cell-text">{LEVEL_LABEL[(level ?? "INSUFFICIENT_DATA") as RiskLevel]}</span>
          </li>
        ))}
      </ol>
      {track.engineChanges.length > 0 && (
        <span className="trend-track-note">
          ▲ 정본 엔진이 {track.engines[track.engineChanges[0]] === "E1" ? "규칙 엔진으로" : "바뀐"} 시점 — 그때 검사값이
          들어왔다
        </span>
      )}
    </li>
  );
}

export function TrendChart({
  series,
  tracks,
  names,
  dates,
  total,
}: {
  series: TrendSeries[];
  tracks: LevelTrack[];
  names: Record<string, string>;
  dates: string[];
  /** 보관함에 있는 전체 시점 수. 창보다 많으면 그 사실을 적는다. */
  total: number;
}) {
  if (dates.length < 2) {
    return (
      <p className="assess-muted">
        시점이 하나뿐입니다. 다음에 검진결과지를 받거나 수치를 다시 재서 한 번 더 기록하면 변화가 그려집니다.
      </p>
    );
  }

  return (
    <div className="trend-wrap">
      <p className="assess-muted">
        {dates.length}개 시점 · {formatDay(dates[0])} ~ {formatDay(dates[dates.length - 1])}
        {total > dates.length && ` · 보관함에 ${total}개가 있고 최근 ${dates.length}개만 그립니다`}
      </p>

      {series.length > 0 ? (
        <div className="trend-grid">
          {series.map((item) => (
            <Sparkline key={item.key} series={item} />
          ))}
        </div>
      ) : (
        <p className="assess-muted">
          두 시점 이상에서 같은 수치를 넣어야 선이 그려집니다. 지금은 겹치는 수치가 없습니다.
        </p>
      )}

      <h3 className="trend-heading">등급이 움직인 질환</h3>
      {tracks.length > 0 ? (
        <ul className="trend-tracks">
          {tracks.map((track) => (
            <LevelRow key={track.key} track={track} names={names} />
          ))}
        </ul>
      ) : (
        <p className="assess-muted">등급이 바뀐 질환이 없습니다.</p>
      )}
    </div>
  );
}
