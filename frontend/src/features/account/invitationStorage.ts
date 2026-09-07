/**
 * 초대 링크의 토큰 및 파라미터를 브라우저 스토리지에 보존하고 복원하는 유틸리티.
 *
 * 사용자가 초대 메일 링크(#invitation=...&token=...&email=...)로 진입한 뒤
 * 비밀번호를 잊어 비밀번호 재설정(#reset_token=...)을 거치더라도,
 * 초기 초대 토큰이 유실되지 않고 계정 페이지의 '받은 초대'에 자동으로 채워지도록 보장한다.
 */

export const PENDING_INVITATION_STORAGE_KEY = "ieobom_pending_invitation";

export interface PendingInvitationData {
  invitationId: string;
  token: string;
  email?: string;
  savedAt: number;
}

function getStorage(): Storage | undefined {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function savePendingInvitation(data: Omit<PendingInvitationData, "savedAt">): void {
  try {
    const storage = getStorage();
    storage?.setItem(
      PENDING_INVITATION_STORAGE_KEY,
      JSON.stringify({ ...data, savedAt: Date.now() }),
    );
  } catch {
    // ignore
  }
}

export function getPendingInvitation(): PendingInvitationData | undefined {
  try {
    const storage = getStorage();
    const raw = storage?.getItem(PENDING_INVITATION_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PendingInvitationData;
    if (parsed && typeof parsed.invitationId === "string" && typeof parsed.token === "string") {
      // 7일이 지난 초대는 만료 처리
      if (typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt > 7 * 24 * 60 * 60 * 1000) {
        storage?.removeItem(PENDING_INVITATION_STORAGE_KEY);
        return undefined;
      }
      return parsed;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function removePendingInvitation(): void {
  try {
    getStorage()?.removeItem(PENDING_INVITATION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * URL 해시(#invitation=...&token=...&email=...) 또는 로컬스토리지로부터
 * 초대 정보를 복원하고, URL에 유효한 초대 정보가 있다면 로컬스토리지에 안전하게 보존한다.
 */
export function readAndPreserveInvitation(): { invitationId: string; token: string; email?: string } | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
  const invitationId = params.get("invitation");
  const token = params.get("token");
  const email = params.get("email") ?? undefined;

  if (invitationId && token) {
    const data = { invitationId, token, email };
    savePendingInvitation(data);
    return data;
  }

  const pending = getPendingInvitation();
  if (pending) {
    return { invitationId: pending.invitationId, token: pending.token, email: pending.email };
  }

  return undefined;
}
