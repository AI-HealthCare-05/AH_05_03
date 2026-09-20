import type { MemberPinRecord } from "./memberPin";
import { isPinSessionFresh } from "./memberPin";

const PREFIX = "ieobom:member-pin:";
const SESSION_KEY = "ieobom:member-pin-session";

export type MemberPinSession = {
  profileId: string;
  unlockedAt: number;
  /** 서버 발급 원문. sessionStorage에만 둔다. 로그에 찍지 않는다. */
  sessionToken?: string;
  expiresAt?: string;
};

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function sessionStorageOrUndefined(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function readPinRecord(profileId: string): MemberPinRecord | undefined {
  const raw = storage()?.getItem(PREFIX + profileId);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as MemberPinRecord;
  } catch {
    return undefined;
  }
}

export function writePinRecord(record: MemberPinRecord): void {
  storage()?.setItem(PREFIX + record.profileId, JSON.stringify(record));
}

export function deletePinRecord(profileId: string): void {
  storage()?.removeItem(PREFIX + profileId);
}

function isStoredSessionLive(session: MemberPinSession, now = Date.now()): boolean {
  if (session.expiresAt) {
    const expiresAt = Date.parse(session.expiresAt);
    if (!Number.isNaN(expiresAt) && expiresAt <= now) return false;
  }
  return isPinSessionFresh(session.unlockedAt, now);
}

export function readPinSession(): MemberPinSession | undefined {
  const raw = sessionStorageOrUndefined()?.getItem(SESSION_KEY);
  if (!raw) return undefined;
  try {
    const session = JSON.parse(raw) as MemberPinSession;
    if (!session.profileId) return undefined;
    if (!isStoredSessionLive(session)) {
      clearPinSession();
      return undefined;
    }
    return session;
  } catch {
    return undefined;
  }
}

export function writePinSession(session: MemberPinSession): void {
  sessionStorageOrUndefined()?.setItem(SESSION_KEY, JSON.stringify(session));
}

export function writeServerPinSession(input: {
  profileId: string;
  sessionToken: string;
  expiresAt: string;
}): void {
  writePinSession({
    profileId: input.profileId,
    unlockedAt: Date.now(),
    sessionToken: input.sessionToken,
    expiresAt: input.expiresAt,
  });
}

export function clearPinSession(): void {
  sessionStorageOrUndefined()?.removeItem(SESSION_KEY);
}

/** 챗봇 헤더용. 원문을 호출부 로그에 넘기지 말 것. */
export function memberSessionToken(): string | undefined {
  return readPinSession()?.sessionToken;
}
