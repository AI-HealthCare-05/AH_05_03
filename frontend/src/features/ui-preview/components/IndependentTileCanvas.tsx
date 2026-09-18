import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";

export interface TilePosition {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  scale?: number;
}

export interface IndependentTile extends TilePosition {
  title: string;
  minW?: number;
  minH?: number;
  content: ReactNode;
}

interface Gesture {
  id: string;
  kind: "move" | "resize-right" | "resize-left" | "resize-bottom" | "resize-corner";
  startX: number;
  startY: number;
  origin: TilePosition;
}

const COLS = 12;
const ROW_HEIGHT = 32;
const GAP = 12;

export function collides(candidate: TilePosition, other: TilePosition): boolean {
  return (
    candidate.x < other.x + other.w &&
    candidate.x + candidate.w > other.x &&
    candidate.y < other.y + other.h &&
    candidate.y + candidate.h > other.y
  );
}

export function isValidTilePosition(candidate: TilePosition, all: TilePosition[]): boolean {
  if (candidate.x < 0 || candidate.y < 0 || candidate.w < 1 || candidate.h < 1 || candidate.x + candidate.w > COLS) {
    return false;
  }
  return all.every((other) => other.id === candidate.id || !collides(candidate, other));
}

/** 충돌하거나 경계를 벗어날 때 가장 가까운 유효 위치를 탐색하여 배치를 보장합니다. */
export function findNearestValidPosition(candidate: TilePosition, all: TilePosition[]): TilePosition | null {
  if (isValidTilePosition(candidate, all)) {
    return candidate;
  }
  const clampedX = Math.max(0, Math.min(COLS - candidate.w, candidate.x));
  const testCandidate = { ...candidate, x: clampedX };
  if (isValidTilePosition(testCandidate, all)) {
    return testCandidate;
  }
  // 같은 행(y)에서 좌우로 여유 위치 탐색
  for (let dx = 1; dx <= COLS - candidate.w; dx++) {
    const leftPos = { ...candidate, x: Math.max(0, clampedX - dx) };
    if (isValidTilePosition(leftPos, all)) return leftPos;
    const rightPos = { ...candidate, x: Math.min(COLS - candidate.w, clampedX + dx) };
    if (isValidTilePosition(rightPos, all)) return rightPos;
  }
  // 같은 행에 공간이 없으면 하단(y + dy)으로 내려가며 탐색
  for (let dy = 1; dy <= 60; dy++) {
    for (let x = 0; x <= COLS - candidate.w; x++) {
      const pos = { ...candidate, x, y: candidate.y + dy };
      if (isValidTilePosition(pos, all)) return pos;
    }
  }
  return null;
}

/** 아래 방향으로 충돌하는 타일들을 연쇄적으로 밀어냅니다. */
export function pushTilesDown(
  pusher: TilePosition,
  allPositions: TilePosition[],
  excludeIds: Set<string> = new Set()
): TilePosition[] {
  const result = allPositions.map((p) => ({ ...p }));
  const queue: TilePosition[] = [pusher];

  while (queue.length > 0) {
    const currentPusher = queue.shift()!;
    for (let i = 0; i < result.length; i++) {
      const tile = result[i];
      if (tile.id === currentPusher.id || excludeIds.has(tile.id)) continue;
      if (collides(currentPusher, tile)) {
        const requiredY = currentPusher.y + currentPusher.h;
        if (tile.y < requiredY) {
          tile.y = requiredY;
          queue.push(tile);
        }
      }
    }
  }

  return result;
}

/** 오른쪽 방향으로 충돌하는 타일들을 밀어내며, 12열을 초과하면 하단으로 안전하게 이동시킵니다. */
export function pushTilesRight(
  active: TilePosition,
  allPositions: TilePosition[]
): TilePosition[] {
  let result = allPositions.map((p) => ({ ...p }));
  const queue: TilePosition[] = [active];
  const excludeIds = new Set<string>([active.id]);
  const needDownPush: TilePosition[] = [];

  while (queue.length > 0) {
    const currentPusher = queue.shift()!;
    for (let i = 0; i < result.length; i++) {
      const tile = result[i];
      if (tile.id === currentPusher.id || excludeIds.has(tile.id)) continue;
      if (collides(currentPusher, tile)) {
        const requiredX = currentPusher.x + currentPusher.w;
        if (requiredX + tile.w <= COLS) {
          tile.x = requiredX;
          queue.push(tile);
        } else {
          tile.x = Math.max(0, Math.min(COLS - tile.w, currentPusher.x));
          tile.y = currentPusher.y + currentPusher.h;
          needDownPush.push(tile);
        }
      }
    }
  }

  for (const wrapped of needDownPush) {
    result = pushTilesDown(wrapped, result, excludeIds);
  }

  return result;
}

/** 왼쪽 방향으로 충돌하는 타일들을 밀어내며, 0열 미만으로 나가면 하단으로 이동시킵니다. */
export function pushTilesLeft(
  active: TilePosition,
  allPositions: TilePosition[]
): TilePosition[] {
  let result = allPositions.map((p) => ({ ...p }));
  const queue: TilePosition[] = [active];
  const excludeIds = new Set<string>([active.id]);
  const needDownPush: TilePosition[] = [];

  while (queue.length > 0) {
    const currentPusher = queue.shift()!;
    for (let i = 0; i < result.length; i++) {
      const tile = result[i];
      if (tile.id === currentPusher.id || excludeIds.has(tile.id)) continue;
      if (collides(currentPusher, tile)) {
        const newX = currentPusher.x - tile.w;
        if (newX >= 0) {
          tile.x = newX;
          queue.push(tile);
        } else {
          tile.x = 0;
          tile.y = currentPusher.y + currentPusher.h;
          needDownPush.push(tile);
        }
      }
    }
  }

  for (const wrapped of needDownPush) {
    result = pushTilesDown(wrapped, result, excludeIds);
  }

  return result;
}

/** 전체 타일 중 남아있는 충돌을 최종 정리(위에서 아래로 스위핑)하여 겹침을 100% 방지 */
export function resolveAnyRemainingCollisions(
  active: TilePosition,
  allPositions: TilePosition[]
): TilePosition[] {
  const result = allPositions.map((p) => (p.id === active.id ? { ...active } : { ...p }));
  let changed = true;
  let passes = 0;
  while (changed && passes < 20) {
    changed = false;
    passes++;
    for (let i = 0; i < result.length; i++) {
      for (let j = 0; j < result.length; j++) {
        if (i === j) continue;
        const a = result[i];
        const b = result[j];
        if (collides(a, b)) {
          if (a.id === active.id) {
            b.y = a.y + a.h;
            changed = true;
          } else if (b.id === active.id) {
            a.y = b.y + b.h;
            changed = true;
          } else {
            if (a.y <= b.y) {
              b.y = a.y + a.h;
            } else {
              a.y = b.y + b.h;
            }
            changed = true;
          }
        }
      }
    }
  }
  return result;
}

/** 길이 조절(리사이즈) 시 조절 방향으로 충돌하는 타일들을 조절된 양만큼 밀어내는 종합 알고리즘 */
export function resolvePushLayout(
  active: TilePosition,
  allPositions: TilePosition[],
  direction: "right" | "left" | "bottom" | "corner" | "vertical" | "horizontal"
): TilePosition[] {
  const clampedActive: TilePosition = {
    ...active,
    x: Math.max(0, Math.min(COLS - 1, active.x)),
    y: Math.max(0, active.y),
    w: Math.max(1, Math.min(COLS - Math.max(0, active.x), active.w)),
    h: Math.max(1, active.h),
  };

  let positions = allPositions.map((p) => (p.id === clampedActive.id ? clampedActive : { ...p }));

  if (direction === "bottom" || direction === "vertical") {
    positions = pushTilesDown(clampedActive, positions, new Set([clampedActive.id]));
  } else if (direction === "right" || direction === "horizontal") {
    positions = pushTilesRight(clampedActive, positions);
  } else if (direction === "left") {
    positions = pushTilesLeft(clampedActive, positions);
  } else if (direction === "corner") {
    positions = pushTilesRight(clampedActive, positions);
    positions = pushTilesDown(clampedActive, positions, new Set([clampedActive.id]));
  }

  positions = resolveAnyRemainingCollisions(clampedActive, positions);
  return positions;
}

export function tileStyle(
  tile: TilePosition,
  unit: number,
  editing: boolean,
  canvasWidth: number,
): CSSProperties {
  if (!editing) {
    const colUnit = canvasWidth / COLS;
    const rowUnit = ROW_HEIGHT + GAP;
    return {
      left: tile.x * colUnit,
      top: tile.y * rowUnit,
      width: tile.w * colUnit,
      height: tile.h * rowUnit,
    };
  }
  return {
    left: tile.x * unit,
    top: tile.y * (ROW_HEIGHT + GAP),
    width: tile.w * unit - GAP,
    height: tile.h * (ROW_HEIGHT + GAP) - GAP,
  };
}

export interface IndependentTileCanvasProps {
  tiles: IndependentTile[];
  storageKey: string;
  pushOnResize?: boolean;
  title?: string;
  slogan?: string;
}

export function IndependentTileCanvas({
  tiles,
  storageKey,
  pushOnResize = false,
  title,
  slogan,
}: IndependentTileCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [editing, setEditing] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(`${storageKey}:editing`);
      return stored !== null ? stored === "true" : false; // 잠금 상태(완벽한 일체형 심리스 뷰)를 기본으로 표시
    } catch {
      return false;
    }
  });
  const [canvasWidth, setCanvasWidth] = useState(1200);
  const [positions, setPositions] = useState<TilePosition[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as TilePosition[] | null;
      if (
        stored &&
        stored.length === tiles.length &&
        stored.every((item) => tiles.some((tile) => tile.id === item.id)) &&
        stored.every((item) => isValidTilePosition(item, stored))
      ) {
        return stored;
      }
    } catch {
      /* use defaults */
    }
    return tiles.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
  });
  const [preview, setPreview] = useState<{
    position: TilePosition;
    allowed: boolean;
    pushedPositions?: TilePosition[];
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => setCanvasWidth(entry.contentRect.width));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const unit = (canvasWidth + GAP) / COLS;
  const canvasRows = useMemo(() => Math.max(18, ...positions.map((tile) => tile.y + tile.h)) + 1, [positions]);

  const start = (event: PointerEvent, tile: IndependentTile, kind: Gesture["kind"]) => {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = positions.find((item) => item.id === tile.id);
    if (!origin) return;
    gestureRef.current = { id: tile.id, kind, startX: event.clientX, startY: event.clientY, origin };
    setPreview({ position: origin, allowed: true });
  };

  const move = (event: PointerEvent) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const dx = Math.round((event.clientX - gesture.startX) / unit);
    const dy = Math.round((event.clientY - gesture.startY) / (ROW_HEIGHT + GAP));
    const spec = tiles.find((tile) => tile.id === gesture.id);
    const minW = spec?.minW ?? 2;
    const minH = spec?.minH ?? 3;

    let candidate: TilePosition;
    switch (gesture.kind) {
      case "move":
        candidate = {
          ...gesture.origin,
          x: Math.max(0, Math.min(COLS - gesture.origin.w, gesture.origin.x + dx)),
          y: Math.max(0, gesture.origin.y + dy),
        };
        break;
      case "resize-right":
        candidate = {
          ...gesture.origin,
          w: Math.max(minW, Math.min(COLS - gesture.origin.x, gesture.origin.w + dx)),
        };
        break;
      case "resize-left": {
        const newX = Math.max(0, Math.min(gesture.origin.x + gesture.origin.w - minW, gesture.origin.x + dx));
        const newW = gesture.origin.w - (newX - gesture.origin.x);
        candidate = {
          ...gesture.origin,
          x: newX,
          w: newW,
        };
        break;
      }
      case "resize-bottom":
        candidate = {
          ...gesture.origin,
          h: Math.max(minH, gesture.origin.h + dy),
        };
        break;
      case "resize-corner":
        candidate = {
          ...gesture.origin,
          w: Math.max(minW, Math.min(COLS - gesture.origin.x, gesture.origin.w + dx)),
          h: Math.max(minH, gesture.origin.h + dy),
        };
        break;
    }

    if (pushOnResize && gesture.kind.startsWith("resize-")) {
      const direction: "bottom" | "right" | "left" | "corner" =
        gesture.kind === "resize-bottom"
          ? "bottom"
          : gesture.kind === "resize-right"
            ? "right"
            : gesture.kind === "resize-left"
              ? "left"
              : "corner";
      const pushedPositions = resolvePushLayout(candidate, positions, direction);
      setPreview({ position: candidate, allowed: true, pushedPositions });
    } else {
      setPreview({ position: candidate, allowed: isValidTilePosition(candidate, positions) });
    }
  };

  const finish = (event: PointerEvent) => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    const next = preview;
    gestureRef.current = null;
    setPreview(null);
    if (!next?.allowed) return;
    setPositions((current) => {
      let updated: TilePosition[];
      if (next.pushedPositions) {
        updated = next.pushedPositions;
      } else {
        updated = current.map((item) => (item.id === next.position.id ? next.position : item));
      }
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch {
        /* ignore */
      }
      return updated;
    });
  };

  const reset = () => {
    const defaults = tiles.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
    setPositions(defaults);
    try {
      localStorage.setItem(storageKey, JSON.stringify(defaults));
    } catch {
      /* ignore */
    }
  };

  const commit = (candidate: TilePosition) => {
    if (!isValidTilePosition(candidate, positions)) return;
    setPositions((current) => {
      const updated = current.map((item) => (item.id === candidate.id ? candidate : item));
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch {
        /* ignore */
      }
      return updated;
    });
  };

  const commitAll = (updated: TilePosition[]) => {
    setPositions(updated);
    try {
      localStorage.setItem(storageKey, JSON.stringify(updated));
    } catch {
      /* ignore */
    }
  };

  const nudge = (tile: IndependentTile, dx: number, dy: number) => {
    const current = positions.find((item) => item.id === tile.id);
    if (!current) return;
    const candidate = {
      ...current,
      x: Math.max(0, Math.min(COLS - current.w, current.x + dx)),
      y: Math.max(0, current.y + dy),
    };
    commit(candidate);
  };

  /** 0.25배(3열), 0.5배(6열), 1배(12열) 가로 너비 설정 */
  const setWidthPreset = (tile: IndependentTile, targetCols: number) => {
    const current = positions.find((item) => item.id === tile.id);
    if (!current) return;
    const minW = tile.minW ?? 2;
    const clampedW = Math.max(minW, Math.min(COLS, targetCols));
    const candidate = {
      ...current,
      x: current.x + clampedW > COLS ? Math.max(0, COLS - clampedW) : current.x,
      w: clampedW,
    };
    if (pushOnResize) {
      const pushed = resolvePushLayout(candidate, positions, "right");
      commitAll(pushed);
    } else {
      const valid = findNearestValidPosition(candidate, positions);
      if (valid) {
        commit(valid);
      }
    }
  };

  /** 1열 단위 가로 너비 미세 증감 */
  const resizeHorizontal = (tile: IndependentTile, dw: number) => {
    const current = positions.find((item) => item.id === tile.id);
    if (!current) return;
    const minW = tile.minW ?? 2;
    const newW = Math.max(minW, Math.min(COLS, current.w + dw));
    const candidate = {
      ...current,
      x: Math.min(current.x, COLS - newW),
      w: newW,
    };
    if (pushOnResize && dw > 0) {
      const pushed = resolvePushLayout(candidate, positions, "right");
      commitAll(pushed);
    } else {
      const valid = findNearestValidPosition(candidate, positions);
      if (valid) {
        commit(valid);
      }
    }
  };

  /** 1블럭 단위 세로 높이 미세 증감 */
  const resizeVertical = (tile: IndependentTile, dh: number) => {
    const current = positions.find((item) => item.id === tile.id);
    if (!current) return;
    const minH = tile.minH ?? 3;
    const newH = Math.max(minH, current.h + dh);
    const candidate = { ...current, h: newH };
    if (pushOnResize && dh > 0) {
      const pushed = resolvePushLayout(candidate, positions, "bottom");
      commitAll(pushed);
    } else {
      const valid = findNearestValidPosition(candidate, positions);
      if (valid) {
        commit(valid);
      }
    }
  };

  /** 차트 내용물 배율 축소/확대 (Zoom: 0.5x, 0.75x, 1x) */
  const setScale = (tile: IndependentTile, scale: number) => {
    setPositions((current) => {
      const updated = current.map((item) => (item.id === tile.id ? { ...item, scale } : item));
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch {
        /* ignore */
      }
      return updated;
    });
  };

  return (
    <section className={`sp-free-layout ${editing ? "is-editing" : "is-locked"}`}>
      <header className="sp-free-toolbar">
        <div>
          <strong>{title ?? "블록 독립 배치 (시안 3)"}</strong>
          <span>
            {slogan ??
              "12열 × 32px 행 · 겹침 금지 · 좌우 크기 및 0.25배 / 0.5배 / 1배 배율 조절 지원"}
          </span>
        </div>
        <div>
          <button type="button" onClick={reset} disabled={!editing}>
            기본 배치 복원
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setEditing((value) => {
                const next = !value;
                try {
                  localStorage.setItem(`${storageKey}:editing`, String(next));
                } catch {
                  /* ignore */
                }
                return next;
              });
            }}
          >
            {editing ? "🔒 배치 잠금" : "🔓 배치 편집"}
          </button>
        </div>
      </header>
      <div
        ref={canvasRef}
        className="sp-free-canvas"
        style={{ height: canvasRows * (ROW_HEIGHT + GAP) }}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        {tiles.map((tile) => {
          const position =
            preview?.pushedPositions?.find((item) => item.id === tile.id) ??
            positions.find((item) => item.id === tile.id) ??
            tile;
          return (
            <article key={tile.id} className="sp-free-tile" style={tileStyle(position, unit, editing, canvasWidth)}>
              {editing ? (
                <header className="sp-free-tile-controls">
                  {/* 드래그 이동 핸들 */}
                  <button
                    type="button"
                    className="sp-free-drag"
                    onPointerDown={(event) => start(event, tile, "move")}
                    aria-label={`${tile.title} 끌어서 이동`}
                    title="마우스로 잡고 원하는 위치로 이동"
                  >
                    <span>⠿</span>
                    <strong>{tile.title}</strong>
                  </button>

                  {/* 1) 0.25배, 0.5배, 1배 가로 크기 원클릭 설정 버튼군 */}
                  <div className="sp-free-scale-group" title="가로 크기 배율 (0.25배 / 0.5배 / 1배)">
                    <button
                      type="button"
                      className={`sp-free-scale-btn ${position.w === 3 ? "active" : ""}`}
                      onClick={() => setWidthPreset(tile, 3)}
                      title="0.25배 크기 (3열·25% 너비)"
                    >
                      0.25배
                    </button>
                    <button
                      type="button"
                      className={`sp-free-scale-btn ${position.w === 6 ? "active" : ""}`}
                      onClick={() => setWidthPreset(tile, 6)}
                      title="0.5배 크기 (6열·50% 너비)"
                    >
                      0.5배
                    </button>
                    <button
                      type="button"
                      className={`sp-free-scale-btn ${position.w === 12 ? "active" : ""}`}
                      onClick={() => setWidthPreset(tile, 12)}
                      title="1배 크기 (12열·100% 전체 너비)"
                    >
                      1배
                    </button>
                  </div>

                  {/* 2) 가로 너비 미세 증감 스텝퍼 */}
                  <div className="sp-free-stepper" title="가로 너비 미세 조절">
                    <span className="sp-free-stepper-label">가로:</span>
                    <button
                      type="button"
                      onClick={() => resizeHorizontal(tile, -1)}
                      disabled={position.w <= (tile.minW ?? 2)}
                      title="가로 너비 줄이기 (-1열)"
                    >
                      -
                    </button>
                    <span className="sp-free-stepper-val">{position.w}/12</span>
                    <button
                      type="button"
                      onClick={() => resizeHorizontal(tile, 1)}
                      disabled={position.w >= 12}
                      title="가로 너비 늘리기 (+1열)"
                    >
                      +
                    </button>
                  </div>

                  {/* 3) 세로 높이 미세 증감 스텝퍼 */}
                  <div className="sp-free-stepper" title="세로 높이 조절">
                    <span className="sp-free-stepper-label">세로:</span>
                    <button
                      type="button"
                      onClick={() => resizeVertical(tile, -1)}
                      disabled={position.h <= (tile.minH ?? 3)}
                      title="세로 높이 줄이기 (-1블럭)"
                    >
                      -
                    </button>
                    <span className="sp-free-stepper-val">{position.h}h</span>
                    <button
                      type="button"
                      onClick={() => resizeVertical(tile, 1)}
                      disabled={position.h >= 40}
                      title="세로 높이 늘리기 (+1블럭)"
                    >
                      +
                    </button>
                  </div>

                  {/* 4) 차트 내용물 축소/확대 배율 (Zoom) */}
                  <div className="sp-free-zoom-group" title="차트 내용물 축소 배율">
                    <span className="sp-free-zoom-label">내용:</span>
                    <button
                      type="button"
                      className={`sp-free-zoom-btn ${(position.scale ?? 1) === 0.5 ? "active" : ""}`}
                      onClick={() => setScale(tile, 0.5)}
                      title="차트 내용 50% 축소"
                    >
                      0.5x
                    </button>
                    <button
                      type="button"
                      className={`sp-free-zoom-btn ${(position.scale ?? 1) === 0.75 ? "active" : ""}`}
                      onClick={() => setScale(tile, 0.75)}
                      title="차트 내용 75% 축소"
                    >
                      0.75x
                    </button>
                    <button
                      type="button"
                      className={`sp-free-zoom-btn ${(position.scale ?? 1) === 1 ? "active" : ""}`}
                      onClick={() => setScale(tile, 1)}
                      title="차트 내용 100% 정상"
                    >
                      1x
                    </button>
                  </div>

                  {/* 5) 위치 미세 이동 */}
                  <div className="sp-free-nudge-group" title="타일 위치 이동">
                    <button type="button" onClick={() => nudge(tile, -1, 0)} title="왼쪽 이동">
                      ←
                    </button>
                    <button type="button" onClick={() => nudge(tile, 1, 0)} title="오른쪽 이동">
                      →
                    </button>
                    <button type="button" onClick={() => nudge(tile, 0, -1)} title="위로 이동">
                      ↑
                    </button>
                    <button type="button" onClick={() => nudge(tile, 0, 1)} title="아래로 이동">
                      ↓
                    </button>
                  </div>
                </header>
              ) : null}

              {/* 타일 내용물 (배율 설정 시 비율 축소 적용) */}
              <div
                className="sp-free-content"
                style={position.scale && position.scale !== 1 ? { zoom: position.scale } : undefined}
              >
                {tile.content}
              </div>

              {/* 드래그 리사이즈 핸들군 */}
              {editing ? (
                <>
                  {/* 좌측 가로 리사이즈 핸들 */}
                  <button
                    type="button"
                    className="sp-free-resize-left"
                    onPointerDown={(event) => start(event, tile, "resize-left")}
                    aria-label={`${tile.title} 좌측 가로 크기 조절`}
                    title="마우스로 좌측 가장자리를 잡고 드래그하여 가로 너비 조절"
                  />
                  {/* 우측 가로 리사이즈 핸들 */}
                  <button
                    type="button"
                    className="sp-free-resize-right"
                    onPointerDown={(event) => start(event, tile, "resize-right")}
                    aria-label={`${tile.title} 우측 가로 크기 조절`}
                    title="마우스로 우측 가장자리를 잡고 드래그하여 가로 너비 조절"
                  />
                  {/* 하단 세로 리사이즈 핸들 */}
                  <button
                    type="button"
                    className="sp-free-resize-bottom"
                    onPointerDown={(event) => start(event, tile, "resize-bottom")}
                    aria-label={`${tile.title} 하단 세로 높이 조절`}
                    title="마우스로 하단 가장자리를 잡고 드래그하여 세로 높이 조절"
                  />
                  {/* 우하단 코너 대각선 리사이즈 핸들 */}
                  <button
                    type="button"
                    className="sp-free-resize-corner"
                    onPointerDown={(event) => start(event, tile, "resize-corner")}
                    aria-label={`${tile.title} 코너 대각선 크기 조절`}
                    title="마우스로 코너를 잡고 대각선으로 드래그하여 가로·세로 동시 조절"
                  />
                </>
              ) : null}
            </article>
          );
        })}
        {preview ? (
          <div
            className={`sp-free-preview ${preview.allowed ? "is-allowed" : "is-blocked"}`}
            style={tileStyle(preview.position, unit, editing, canvasWidth)}
          >
            <span>{preview.allowed ? "이 블록에 배치" : "다른 타일과 겹칩니다"}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
