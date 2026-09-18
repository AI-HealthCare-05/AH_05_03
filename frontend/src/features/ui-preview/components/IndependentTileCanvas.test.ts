import { describe, expect, it } from "vitest";

import {
  collides,
  findNearestValidPosition,
  isValidTilePosition,
  resolvePushLayout,
  tileStyle,
  type TilePosition,
} from "./IndependentTileCanvas";

const placed: TilePosition[] = [
  { id: "a", x: 0, y: 0, w: 4, h: 4 },
  { id: "b", x: 5, y: 0, w: 3, h: 3 },
];

describe("IndependentTileCanvas collision contract", () => {
  it("맞닿기만 한 블록은 겹침으로 보지 않는다", () => {
    expect(collides(placed[0], { id: "c", x: 4, y: 0, w: 1, h: 4 })).toBe(false);
  });

  it("한 블록이라도 점유 영역이 겹치면 배치를 거부한다", () => {
    expect(isValidTilePosition({ id: "c", x: 3, y: 2, w: 3, h: 2 }, placed)).toBe(false);
  });

  it("빈 블록에는 다른 타일을 움직이지 않고 배치할 수 있다", () => {
    expect(isValidTilePosition({ id: "c", x: 8, y: 0, w: 4, h: 5 }, placed)).toBe(true);
  });

  it("12열 캔버스 경계를 벗어난 배치를 거부한다", () => {
    expect(isValidTilePosition({ id: "c", x: 10, y: 0, w: 3, h: 2 }, placed)).toBe(false);
  });

  it("가로 크기 변경 시 충돌하면 가장 가까운 유효 위치를 찾아 배치한다", () => {
    // c tries to be at (3, 0) with w=6 (0.5x), which collides with a(0,0,4,4) and b(5,0,3,3)
    const candidate: TilePosition = { id: "c", x: 3, y: 0, w: 6, h: 3 };
    const valid = findNearestValidPosition(candidate, placed);
    expect(valid).not.toBeNull();
    expect(isValidTilePosition(valid!, placed)).toBe(true);
  });

  it("가로 12열(1배) 전체 크기 지정 시 빈 행으로 안전하게 배치한다", () => {
    const candidate: TilePosition = { id: "c", x: 0, y: 0, w: 12, h: 4 };
    const valid = findNearestValidPosition(candidate, placed);
    expect(valid).not.toBeNull();
    expect(valid?.w).toBe(12);
    expect(valid?.x).toBe(0);
    expect(isValidTilePosition(valid!, placed)).toBe(true);
  });
});

describe("IndependentTileCanvas tileStyle seamless lock contract", () => {
  const canvasWidth = 1200; // 12열 기준 1열 = 100px
  const unit = (canvasWidth + 12) / 12; // 편집 모드 unit = 101px

  it("편집 모드에서는 타일 사이에 12px 간격이 존재한다", () => {
    const tileA: TilePosition = { id: "t1", x: 0, y: 0, w: 5, h: 4 };
    const tileB: TilePosition = { id: "t2", x: 5, y: 0, w: 7, h: 4 };
    const styleA = tileStyle(tileA, unit, true, canvasWidth);
    const styleB = tileStyle(tileB, unit, true, canvasWidth);

    // styleA right edge = left + width = 0 + (5 * 101 - 12) = 493px
    // styleB left = 5 * 101 = 505px
    // Gap = 505 - 493 = 12px
    const rightEdgeA = Number(styleA.left) + Number(styleA.width);
    expect(Number(styleB.left) - rightEdgeA).toBe(12);
  });

  it("잠금 모드에서는 인접한 타일 간에 간격(이음새)이 0px로 감쪽같이 일체화된다", () => {
    const tileA: TilePosition = { id: "t1", x: 0, y: 0, w: 5, h: 4 };
    const tileB: TilePosition = { id: "t2", x: 5, y: 0, w: 7, h: 4 };
    const styleA = tileStyle(tileA, unit, false, canvasWidth);
    const styleB = tileStyle(tileB, unit, false, canvasWidth);

    // styleA right edge = 0 + (5 * 100) = 500px
    // styleB left = 5 * 100 = 500px
    // Gap = 500 - 500 = 0px
    const rightEdgeA = Number(styleA.left) + Number(styleA.width);
    expect(Number(styleB.left) - rightEdgeA).toBe(0);
    expect(Number(styleA.width) + Number(styleB.width)).toBe(canvasWidth);
  });

  it("잠금 모드에서 세로로 인접한 타일 간에도 이음새 없이 맞닿는다", () => {
    const tileTop: TilePosition = { id: "t1", x: 0, y: 0, w: 12, h: 5 };
    const tileBottom: TilePosition = { id: "t2", x: 0, y: 5, w: 12, h: 9 };
    const styleTop = tileStyle(tileTop, unit, false, canvasWidth);
    const styleBottom = tileStyle(tileBottom, unit, false, canvasWidth);

    const bottomEdgeTop = Number(styleTop.top) + Number(styleTop.height);
    expect(Number(styleBottom.top) - bottomEdgeTop).toBe(0);
  });
});

describe("IndependentTileCanvas pushOnResize (시안 10 길이 조절 타일 밀어내기 계약)", () => {
  it("하단(세로) 길이 조절 시 하단에 위치한 충돌 타일들을 늘어난 만큼 연쇄적으로 아래로 밀어낸다", () => {
    const original: TilePosition[] = [
      { id: "top", x: 0, y: 0, w: 12, h: 4 },
      { id: "mid", x: 0, y: 4, w: 6, h: 4 },
      { id: "bottom", x: 0, y: 8, w: 12, h: 4 },
    ];

    // top tile is resized downward from h: 4 to h: 7 (+3 elongation)
    const active: TilePosition = { id: "top", x: 0, y: 0, w: 12, h: 7 };
    const pushed = resolvePushLayout(active, original, "bottom");

    const pushedTop = pushed.find((t) => t.id === "top")!;
    const pushedMid = pushed.find((t) => t.id === "mid")!;
    const pushedBottom = pushed.find((t) => t.id === "bottom")!;

    expect(pushedTop.h).toBe(7);
    expect(pushedMid.y).toBe(7); // top 끝나는 7행으로 밀려남 (기존 4행에서 +3)
    expect(pushedBottom.y).toBe(11); // mid(7+4=11) 아래로 연쇄 밀려남 (기존 8행에서 +3)
  });

  it("우측(가로) 길이 조절 시 우측 타일을 오른쪽으로 밀어내며 12열 내에 안전하게 배치한다", () => {
    const original: TilePosition[] = [
      { id: "left", x: 0, y: 0, w: 4, h: 4 },
      { id: "right", x: 4, y: 0, w: 4, h: 4 },
    ];

    // left tile is resized rightward from w: 4 to w: 6 (+2 elongation)
    const active: TilePosition = { id: "left", x: 0, y: 0, w: 6, h: 4 };
    const pushed = resolvePushLayout(active, original, "right");

    const pushedLeft = pushed.find((t) => t.id === "left")!;
    const pushedRight = pushed.find((t) => t.id === "right")!;

    expect(pushedLeft.w).toBe(6);
    expect(pushedRight.x).toBe(6); // 6열로 밀려남
    expect(pushedRight.x + pushedRight.w).toBe(10); // 12열 이내 안전 안착
  });

  it("우측(가로) 확장 시 12열을 초과하는 타일은 하단 행으로 안전하게 이동 후 연쇄 밀어낸다", () => {
    const original: TilePosition[] = [
      { id: "tileA", x: 0, y: 0, w: 5, h: 6 },
      { id: "tileB", x: 5, y: 0, w: 7, h: 6 },
      { id: "tileC", x: 0, y: 6, w: 12, h: 6 },
    ];

    // tileA expands from w: 5 to w: 8.
    // tileB (w: 7) at x: 8 would exceed 12 (8+7=15).
    // tileB drops down to y: 6, pushing tileC down to y: 12!
    const active: TilePosition = { id: "tileA", x: 0, y: 0, w: 8, h: 6 };
    const pushed = resolvePushLayout(active, original, "right");

    const pushedA = pushed.find((t) => t.id === "tileA")!;
    const pushedB = pushed.find((t) => t.id === "tileB")!;
    const pushedC = pushed.find((t) => t.id === "tileC")!;

    expect(pushedA.w).toBe(8);
    expect(pushedB.y).toBe(6); // 하단으로 이동
    expect(pushedC.y).toBe(12); // 기존 y: 6에서 tileB 아래로 연쇄 밀려남
  });
});
