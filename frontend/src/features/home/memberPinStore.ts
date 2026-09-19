import type { MemberPinRecord } from "./memberPin";

const PREFIX = "ieobom:member-pin:";
const SESSION_KEY = "ieobom:member-pin-session";

export type MemberPinSession = {
  profileId: string;
  unlockedAt: number;
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

export function readPinSession(): MemberPinSession | undefined {
  const raw = sessionStorageOrUndefined()?.getItem(SESSION_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as MemberPinSession;
  } catch {
    return undefined;
  }
}

export function writePinSession(session: MemberPinSession): void {
  sessionStorageOrUndefined()?.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearPinSession(): void {
  sessionStorageOrUndefined()?.removeItem(SESSION_KEY);
}
