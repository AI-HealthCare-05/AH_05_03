/**
 * 스크롤 진행도 계산.
 *
 * 여기서 0 으로 나누거나 범위를 벗어나면 화면이 깨지는 게 아니라 **장면이 건너뛴다** —
 * 스크롤을 빨리 내렸을 때 글자가 한 번 번쩍이고 사라지는 증상이 대개 이것이다.
 */

import { describe, expect, it } from "vitest";

import { sceneIndexOf, sceneLocalProgress, sectionProgress } from "./scrollProgress";

describe("섹션 진행도", () => {
  it("들어오기 전은 0, 붙어 있는 동안 0~1, 지나가면 1", () => {
    // 섹션 높이 3000, 뷰포트 1000 → 붙어 있는 거리는 2000.
    expect(sectionProgress(500, 3000, 1000)).toBe(0);
    expect(sectionProgress(0, 3000, 1000)).toBe(0);
    expect(sectionProgress(-1000, 3000, 1000)).toBe(0.5);
    expect(sectionProgress(-2000, 3000, 1000)).toBe(1);
    expect(sectionProgress(-9000, 3000, 1000)).toBe(1);
  });

  it("섹션이 뷰포트보다 짧아도 0 으로 나누지 않는다", () => {
    // 모션 축소에서 고정이 풀리면 실제로 이 모양이 된다.
    expect(sectionProgress(10, 400, 1000)).toBe(0);
    expect(sectionProgress(-10, 400, 1000)).toBe(1);
  });

  it("장면 번호는 마지막 장면을 넘지 않는다", () => {
    expect(sceneIndexOf(0, 5)).toBe(0);
    expect(sceneIndexOf(0.19, 5)).toBe(0);
    expect(sceneIndexOf(0.2, 5)).toBe(1);
    expect(sceneIndexOf(0.99, 5)).toBe(4);
    // 끝에서 `Math.floor(1 * 5)` 가 5 가 되어 배열 밖을 가리키던 자리.
    expect(sceneIndexOf(1, 5)).toBe(4);
    expect(sceneIndexOf(1, 1)).toBe(0);
  });

  it("장면 안 진행도는 장면마다 0 에서 다시 시작한다", () => {
    expect(sceneLocalProgress(0, 4)).toBeCloseTo(0, 5);
    expect(sceneLocalProgress(0.125, 4)).toBeCloseTo(0.5, 5);
    expect(sceneLocalProgress(1, 4)).toBe(1);
  });
});
