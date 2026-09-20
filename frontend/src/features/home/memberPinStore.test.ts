import { afterEach, describe, expect, it } from "vitest";

import {
  clearPinSession,
  memberSessionToken,
  readPinSession,
  writePinRecord,
  writePinSession,
  writeServerPinSession,
} from "./memberPinStore";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("memberPinStore", () => {
  it("서버 세션 토큰은 sessionStorage에만 두고 만료되면 버린다", () => {
    writePinRecord({
      profileId: "p-1",
      saltB64: "c2FsdA==",
      hashB64: "aGFzaA==",
      iterations: 1,
      mustChange: false,
      failedAttempts: 0,
      lockedUntil: null,
      role: "adult_member",
    });
    writeServerPinSession({
      profileId: "p-1",
      sessionToken: "member-session-raw",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(memberSessionToken()).toBe("member-session-raw");
    expect(sessionStorage.getItem("ieobom:member-pin-session")).toContain("member-session-raw");
    expect(localStorage.getItem("ieobom:member-pin-session")).toBeNull();
    expect(localStorage.getItem("ieobom:member-pin:p-1")).not.toContain("member-session-raw");

    writePinSession({
      profileId: "p-1",
      unlockedAt: Date.now(),
      sessionToken: "member-session-raw",
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    expect(readPinSession()).toBeUndefined();
    expect(memberSessionToken()).toBeUndefined();
    expect(sessionStorage.getItem("ieobom:member-pin-session")).toBeNull();
  });

  it("잠그면 세션 원문을 지운다", () => {
    writeServerPinSession({
      profileId: "p-1",
      sessionToken: "member-session-raw",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    clearPinSession();
    expect(memberSessionToken()).toBeUndefined();
  });
});
