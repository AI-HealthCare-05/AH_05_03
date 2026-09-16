/**
 * 기록과 변화.
 *
 * 그래프를 한 번에 전부 띄우지 않는다. 스크롤이 시간축을 밀고, 선은 그 속도로
 * **그려진다.** 옆에서는 챌린지 정원의 나무가 같은 4주 동안 자란다 —
 * 앱의 `features/challenge/GardenArt` 를 그대로 가져다 쓴다(랜딩용 그림을 새로
 * 그리면 가입 뒤에 만나는 나무와 달라진다).
 *
 * 두 선은 축이 다르다(수행률 % · 공복혈당 mg/dL). 단위를 legend 에 적지 않으면
 * "혈당이 올라간 것" 으로 읽힐 수 있다.
 */

import { Tree } from "../../challenge/GardenArt";
import type { TreeKey } from "../../challenge/contracts";
import {
  LANDING_METRIC_LABEL,
  LANDING_METRIC_UNIT,
  LANDING_WEEKS,
} from "../../landing/landingStory";
import { useSceneIndex, useSectionProgress } from "../../landing/scrollProgress";

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 250;
const PAD_X = 46;
const PAD_Y = 36;

/** 4주 동안의 나무. 앱의 여섯 단계 중 앞의 넷을 쓴다. */
const TREE_STAGES: TreeKey[] = ["sprout", "sapling", "young", "tree"];

function pointsOf(values: number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (VIEW_WIDTH - PAD_X * 2) / Math.max(1, values.length - 1);
  return values
    .map((value, index) => {
      const x = PAD_X + stepX * index;
      const y = PAD_Y + (1 - (value - min) / span) * (VIEW_HEIGHT - PAD_Y * 2);
      return `${Math.round(x)},${Math.round(y)}`;
    })
    .join(" ");
}

export function ProgressV2() {
  const { index, update } = useSceneIndex(LANDING_WEEKS.length);
  const ref = useSectionProgress<HTMLElement>({ onProgress: update });

  const week = LANDING_WEEKS[index] ?? LANDING_WEEKS[0];
  const ratePoints = pointsOf(LANDING_WEEKS.map((item) => item.rate));
  const metricPoints = pointsOf(LANDING_WEEKS.map((item) => item.metricValue));

  return (
    <section className="lnv2-trend lnv2-scroll" ref={ref} aria-labelledby="lnv2-trend-title">
      <div className="lnv2-sticky lnv2-trend-stage">
        <header className="lnv2-head">
          <p className="lnv2-chip">기록과 변화</p>
          <h2 id="lnv2-trend-title" className="lnv2-headline">
            작은 기록이,
            <br />
            건강의 변화를 만듭니다.
          </h2>
        </header>

        <div className="lnv2-trend-body">
          <div className="lnv2-trend-chart">
            <div className="lnv2-trend-readout">
              <p className="lnv2-trend-week">{week.label}</p>
              <p className="lnv2-trend-metric">
                {week.metricValue}
                <small>{LANDING_METRIC_UNIT}</small>
              </p>
              <p className="lnv2-trend-caption">
                {LANDING_METRIC_LABEL} · 챌린지 수행률 {week.rate}%
              </p>
            </div>

            <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label="4주간 수행률과 공복혈당 추이">
              <g className="lnv2-trend-grid" aria-hidden="true">
                {LANDING_WEEKS.map((item, itemIndex) => {
                  const x = PAD_X + ((VIEW_WIDTH - PAD_X * 2) / (LANDING_WEEKS.length - 1)) * itemIndex;
                  return (
                    <line
                      key={item.label}
                      x1={x}
                      y1={PAD_Y - 16}
                      x2={x}
                      y2={VIEW_HEIGHT - PAD_Y + 16}
                      data-done={itemIndex <= index}
                    />
                  );
                })}
              </g>
              <polyline className="lnv2-trend-line is-rate" points={ratePoints} pathLength={1} />
              <polyline className="lnv2-trend-line is-metric" points={metricPoints} pathLength={1} />
              <g className="lnv2-trend-labels" aria-hidden="true">
                {LANDING_WEEKS.map((item, itemIndex) => {
                  const x = PAD_X + ((VIEW_WIDTH - PAD_X * 2) / (LANDING_WEEKS.length - 1)) * itemIndex;
                  return (
                    <text key={item.label} x={x} y={VIEW_HEIGHT - 4} data-done={itemIndex <= index}>
                      {item.label}
                    </text>
                  );
                })}
              </g>
            </svg>

            <ul className="lnv2-trend-legend" aria-hidden="true">
              <li className="is-rate">챌린지 수행률 (%)</li>
              <li className="is-metric">
                {LANDING_METRIC_LABEL} ({LANDING_METRIC_UNIT})
              </li>
            </ul>
          </div>

          <figure className="lnv2-trend-garden">
            <Tree stage={TREE_STAGES[index] ?? "sprout"} size={140} label={`${week.label} 정원`} />
            <figcaption>
              기록을 남긴 만큼 자라는 정원.
              <br />
              건강 상태가 아니라 <strong>행동</strong>으로 자랍니다.
            </figcaption>
          </figure>
        </div>

        <p className="lnv2-sr-only">
          {LANDING_WEEKS.map(
            (item) =>
              `${item.label} 수행률 ${item.rate}%, ${LANDING_METRIC_LABEL} ${item.metricValue} ${LANDING_METRIC_UNIT}`,
          ).join(". ")}
        </p>
      </div>
    </section>
  );
}
