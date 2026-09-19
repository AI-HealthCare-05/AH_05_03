/**
 * Codex v2 봄이 시트. 셀 192×208, 8열×11행.
 * 시선 000° 는 정면이 아니라 **위쪽**.
 */

import type { BomiMood } from "./bomiMood";

export type BomiState =
  | "idle"
  | "hover"
  | "jumping"
  | "dragging"
  | "released"
  | "waving"
  | "thinking"
  | "waiting"
  | "review"
  | "failed"
  | "looking"
  | "staring"
  | "smiling"
  | "squinting";

export const BOMI_SHEET = {
  columns: 8,
  rows: 11,
  cellWidth: 192,
  cellHeight: 208,
} as const;

export const STATE_PRIORITY: Record<BomiState, number> = {
  dragging: 100,
  released: 90,
  jumping: 80,
  failed: 70,
  waving: 60,
  thinking: 50,
  waiting: 50,
  review: 50,
  looking: 20,
  staring: 21,
  squinting: 21,
  smiling: 22,
  hover: 18,
  idle: 10,
};

export const animationTiming = {
  idle: { frameDuration: 260, loopPause: 900 },
  waving: { frameDuration: 150, loop: false },
  jumping: { frameDuration: 120, loop: false },
  failed: { frameDuration: 160, loop: false, holdLastFrame: 140 },
  waiting: { frameDuration: 240, loopPause: 600 },
  thinking: { frameDuration: 200, loopPause: 250 },
  review: { frameDuration: 220, loopPause: 350 },
  looking: { frameDuration: 140, loop: false },
  dragging: { frameDuration: 90, loop: true },
  released: { frameDuration: 200, loop: false },
  hover: { frameDuration: 260, loop: false },
  staring: { frameDuration: 260, loop: false },
  squinting: { frameDuration: 260, loop: false },
  smiling: { frameDuration: 260, loop: false },
} as const;

type Strip = { row: number; frames: number; pingPong?: boolean };

export const STATE_STRIP: Record<
  Exclude<BomiState, "looking" | "dragging" | "hover" | "released" | "staring" | "smiling" | "squinting">,
  Strip
> = {
  idle: { row: 0, frames: 6, pingPong: true },
  waving: { row: 3, frames: 4 },
  jumping: { row: 4, frames: 5 },
  failed: { row: 5, frames: 5 },
  waiting: { row: 6, frames: 6, pingPong: true },
  thinking: { row: 7, frames: 6, pingPong: true },
  review: { row: 8, frames: 6, pingPong: true },
};

export const RUN_RIGHT = { row: 1, frames: 8 } as const;
export const RUN_LEFT = { row: 2, frames: 8 } as const;

export const STARE_CELL = { row: 0, column: 2 } as const;
export const SMILE_CELL = { row: 0, column: 3 } as const;
export const SQUINT_CELL = { row: 0, column: 1 } as const;
export const WINK_CELL = { row: 2, column: 3 } as const;

const BOTH_EYES_SMILE_COLUMNS: Record<number, ReadonlySet<number>> = {
  0: new Set([0, 1, 3]),
  1: new Set([0, 2, 3, 4, 6, 7]),
  2: new Set([0, 4, 6]),
};

const SAME_ROW_WINK_COLUMN: Record<number, readonly [number, number]> = {
  0: [4, 5],
  1: [1, 5],
  2: [1, 5],
};

export function remapDragCell(row: number, column: number): { row: number; column: number } {
  if (!BOTH_EYES_SMILE_COLUMNS[row]?.has(column)) {
    return { row, column };
  }
  const pair = SAME_ROW_WINK_COLUMN[row];
  if (!pair) return WINK_CELL;
  return { row, column: column < 4 ? pair[0] : pair[1] };
}

export const SERVICE_MOOD_DEBOUNCE_MS = 320;
export const MIN_STATE_HOLD_MS = 300;
export const JUMP_HOVER_DELAY_MS = 150;
export const JUMP_COOLDOWN_MS = 1500;
export const LOOK_DEADZONE_PX = 35;
export const DRAG_THRESHOLD_PX = 5;
export const DRAG_HOLD_LIFT_PX = 42;
export const DRAG_INERTIA_MS = 110;
export const DRAG_INERTIA_DAMP = 0.82;
export const DRAG_INERTIA_MIN_SPEED = 28;
export const DRAG_SNAP_HOME_MS = 180;
export const DRAG_SHAKE_PATH_PX = 320;
export const DRAG_SHAKE_REVERSALS = 4;
export const DRAG_SHAKE_PEAK_SPEED = 1100;
export const DIZZY_PLAYS = 2;
export const POINTER_STILL_MS = 450;
export const POINTER_MOVE_EPSILON_PX = 3;

export const IDLE_FACE_CYCLE = ["smiling", "squinting", "staring"] as const;
export type IdleFace = (typeof IDLE_FACE_CYCLE)[number];

export const IDLE_FACE_HOLD_MS: Record<IdleFace, readonly [number, number]> = {
  smiling: [7_000, 10_000],
  squinting: [900, 1_100],
  staring: [1_000, 2_000],
};

export function jitterHoldMs(min: number, max: number, rand: () => number = Math.random): number {
  return min + rand() * (max - min);
}

export function nextIdleFace(current: IdleFace): IdleFace {
  const index = IDLE_FACE_CYCLE.indexOf(current);
  return IDLE_FACE_CYCLE[(index + 1) % IDLE_FACE_CYCLE.length];
}

export function isIdleFace(state: BomiState): state is IdleFace {
  return (IDLE_FACE_CYCLE as readonly string[]).includes(state);
}

export function moodToServiceState(mood: BomiMood): BomiState {
  switch (mood) {
    case "happy":
      return "waving";
    case "thinking":
      return "thinking";
    case "listen":
      return "waiting";
    case "alert":
      return "idle";
    case "love":
      return "review";
    case "wink":
      return "idle";
    default:
      return "idle";
  }
}

export function canPreempt(current: BomiState, next: BomiState): boolean {
  if (current === next) return false;
  return STATE_PRIORITY[next] >= STATE_PRIORITY[current];
}

export function lookIndexFromVector(dx: number, dy: number): number {
  const radians = Math.atan2(dx, -dy);
  const degrees = ((radians * 180) / Math.PI + 360) % 360;
  return Math.round(degrees / 22.5) % 16;
}

export function lookCell(index: number): { row: number; column: number } {
  const wrapped = ((index % 16) + 16) % 16;
  if (wrapped < 8) return { row: 9, column: wrapped };
  return { row: 10, column: wrapped - 8 };
}

export function shortestLookDelta(from: number, to: number): number {
  const raw = (to - from + 16) % 16;
  return raw > 8 ? raw - 16 : raw;
}

export function isVigorousShake(sample: {
  pathPx: number;
  reversals: number;
  peakSpeed: number;
}): boolean {
  return (
    sample.pathPx >= DRAG_SHAKE_PATH_PX &&
    sample.reversals >= DRAG_SHAKE_REVERSALS &&
    sample.peakSpeed >= DRAG_SHAKE_PEAK_SPEED
  );
}

export function pingPongIndex(step: number, frames: number): number {
  if (frames <= 1) return 0;
  const cycle = frames * 2 - 2;
  const t = ((step % cycle) + cycle) % cycle;
  return t < frames ? t : cycle - t;
}
