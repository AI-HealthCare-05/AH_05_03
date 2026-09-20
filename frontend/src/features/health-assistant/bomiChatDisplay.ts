export const CHAT_SIZE_STEPS = ["md", "lg", "xl"] as const;
export const CHAT_TYPE_STEPS = ["md", "lg", "xl"] as const;

export type ChatSizeStep = (typeof CHAT_SIZE_STEPS)[number];
export type ChatTypeStep = (typeof CHAT_TYPE_STEPS)[number];

export const CHAT_HEADER_GAP = 64;
export const CHAT_BOTTOM_GAP = 120;
export const BOMI_CHAT_DISPLAY_KEY = "ieobom:bomi-chat-display";

const STEP_T: Record<ChatSizeStep, number> = {
  md: 0,
  lg: 0.48,
  xl: 1,
};

const STEP_RATIO: Record<ChatSizeStep, number> = {
  md: 1.62,
  lg: 1.48,
  xl: 1.32,
};

export const CHAT_TYPE_PX: Record<ChatTypeStep, number> = {
  md: 14,
  lg: 16,
  xl: 18,
};

export const CHAT_TYPE_SCALE: Record<ChatTypeStep, number> = {
  md: 1,
  lg: 16 / 14,
  xl: 18 / 14,
};

export interface BomiChatDisplay {
  size: ChatSizeStep;
  type: ChatTypeStep;
  widthPx?: number;
}

export interface ChatFrame {
  width: number;
  height: number;
  minWidth: number;
  maxWidth: number;
}

function isSizeStep(value: unknown): value is ChatSizeStep {
  return CHAT_SIZE_STEPS.includes(value as ChatSizeStep);
}

function isTypeStep(value: unknown): value is ChatTypeStep {
  return CHAT_TYPE_STEPS.includes(value as ChatTypeStep);
}

export function readBomiChatDisplay(): BomiChatDisplay {
  try {
    const raw = localStorage.getItem(BOMI_CHAT_DISPLAY_KEY);
    if (!raw) return { size: "md", type: "md" };
    const parsed = JSON.parse(raw) as Partial<BomiChatDisplay>;
    return {
      size: isSizeStep(parsed.size) ? parsed.size : "md",
      type: isTypeStep(parsed.type) ? parsed.type : "md",
      widthPx: typeof parsed.widthPx === "number" && Number.isFinite(parsed.widthPx) ? parsed.widthPx : undefined,
    };
  } catch {
    return { size: "md", type: "md" };
  }
}

export function writeBomiChatDisplay(display: BomiChatDisplay): void {
  localStorage.setItem(BOMI_CHAT_DISPLAY_KEY, JSON.stringify(display));
}

export function stepChatValue<T extends string>(steps: readonly T[], current: T, delta: -1 | 1): T {
  const index = Math.max(0, steps.indexOf(current));
  return steps[Math.max(0, Math.min(steps.length - 1, index + delta))] ?? current;
}

export function chatSizeBounds(viewportWidth: number, viewportHeight: number): {
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
} {
  const maxHeight = Math.max(460, viewportHeight - CHAT_HEADER_GAP - CHAT_BOTTOM_GAP);
  const maxWidth = Math.round(
    Math.min(viewportWidth * 0.42, viewportWidth - 48, maxHeight / 1.28),
  );
  const minWidth = Math.round(Math.min(380, maxWidth));
  return { minWidth, maxWidth: Math.max(minWidth, maxWidth), maxHeight };
}

function widthForStep(size: ChatSizeStep, minWidth: number, maxWidth: number): number {
  const comfort = Math.min(420, maxWidth);
  return Math.round(comfort + (maxWidth - comfort) * STEP_T[size]);
}

export function measureChatFrame(
  size: ChatSizeStep,
  viewportWidth: number,
  viewportHeight: number,
  customWidth?: number,
): ChatFrame {
  const { minWidth, maxWidth, maxHeight } = chatSizeBounds(viewportWidth, viewportHeight);
  const preferred = widthForStep(size, minWidth, maxWidth);
  const width = Math.round(Math.min(maxWidth, Math.max(minWidth, customWidth ?? preferred)));
  const height = Math.round(Math.min(maxHeight, Math.max(480, width * STEP_RATIO[size])));
  return { width, height, minWidth, maxWidth };
}
