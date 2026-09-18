import idle from "./assets/bomi/idle.png";
import happy from "./assets/bomi/happy.png";
import wink from "./assets/bomi/wink.png";
import thinking from "./assets/bomi/thinking.png";
import listen from "./assets/bomi/listen.png";
import alert from "./assets/bomi/alert.png";
import love from "./assets/bomi/love.png";

/** 봄이 표정. 런처·말풍선·대화 상태에 맞춰 고른다. */
export type BomiMood = "idle" | "happy" | "wink" | "thinking" | "listen" | "alert" | "love";

export const BOMI_AVATARS: Record<BomiMood, string> = {
  idle,
  happy,
  wink,
  thinking,
  listen,
  alert,
  love,
};

export function pickLauncherMood(state: {
  isOpen: boolean;
  hasUnread: boolean;
  showTooltip: boolean;
  hovering: boolean;
}): BomiMood {
  if (state.isOpen) return "listen";
  if (state.hasUnread) return "alert";
  if (state.hovering) return "wink";
  if (state.showTooltip) return "happy";
  return "idle";
}
