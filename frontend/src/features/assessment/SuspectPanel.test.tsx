/**
 * 같은 값이 이어지는 구간을 접는 규칙 — `collapseRuns`.
 *
 * **왜 이 파일이 생겼나.** 급한 셋 패널이 여섯 줄을 세로로 쌓는데 그중 다섯이 같은
 * 숫자인 경우가 흔하다(실측 `15% 15% 15% 15% 15% 20%`). 원인은 모델이 둘이라서가
 * 아니다 — 질환마다 모델은 **하나**고 `age` 만 옮겨 다시 채점하므로, GBDT 의 나이
 * 분기 사이에 든 해는 값이 글자 그대로 같다.
 *
 * 접는 것은 **표시**일 뿐이고 값을 다듬지 않는다. 그 경계를 여기서 못 박는다.
 */

import { describe, expect, it } from "vitest";

import { collapseRuns } from "./SuspectPanel";

const at = (years: number, value: number) => ({ years, value });

describe("collapseRuns", () => {
  it("이어지는 같은 값을 범위 한 줄로 묶는다", () => {
    const runs = collapseRuns([
      at(0, 0.1454),
      at(1, 0.1454),
      at(2, 0.1454),
      at(3, 0.1454),
      at(4, 0.1454),
      at(5, 0.1972),
    ]);

    expect(runs.map((r) => r.when)).toEqual(["지금 ~ 4년 뒤", "5년 뒤"]);
    // **값을 바꾸지 않는다.** 접는 것은 표시일 뿐이다.
    expect(runs.map((r) => r.value)).toEqual([0.1454, 0.1972]);
  });

  it("전부 다르면 한 줄도 묶지 않는다", () => {
    const runs = collapseRuns([at(0, 0.1), at(1, 0.2), at(2, 0.3)]);

    expect(runs.map((r) => r.when)).toEqual(["지금", "1년 뒤", "2년 뒤"]);
  });

  it("전부 같으면 한 줄로 접는다", () => {
    const runs = collapseRuns([at(0, 0.85), at(1, 0.85), at(2, 0.85), at(5, 0.85)]);

    expect(runs).toHaveLength(1);
    expect(runs[0].when).toBe("지금 ~ 5년 뒤");
  });

  it("양쪽이 다 연수면 \"뒤\" 를 한 번만 쓴다", () => {
    // `3년 뒤 ~ 4년 뒤` 는 같은 말을 두 번 읽게 한다.
    const runs = collapseRuns([at(0, 0.1), at(3, 0.5), at(4, 0.5)]);

    expect(runs.map((r) => r.when)).toEqual(["지금", "3 ~ 4년 뒤"]);
  });

  it("가운데만 같아도 그 구간만 묶는다 — 내려가는 곡선도 접는다", () => {
    // 가역 질환은 유병 확률이 내려갈 수 있다(비만 85 → 78). 접기는 방향과 무관하다.
    const runs = collapseRuns([at(0, 0.85), at(1, 0.85), at(2, 0.85), at(3, 0.78), at(4, 0.78)]);

    expect(runs.map((r) => r.when)).toEqual(["지금 ~ 2년 뒤", "3 ~ 4년 뒤"]);
  });

  it("0.5%p 미만 차이는 같은 값으로 본다 — 화면이 정수 %로 반올림하기 때문", () => {
    // 15.01% 와 15.02% 를 두 줄로 적으면 같은 "15%" 가 두 번 선다.
    const runs = collapseRuns([at(0, 0.1501), at(1, 0.1502), at(2, 0.1503)]);

    expect(runs).toHaveLength(1);
  });

  it("한 점뿐이면 범위로 적지 않는다", () => {
    expect(collapseRuns([at(0, 0.2)]).map((r) => r.when)).toEqual(["지금"]);
  });
});
