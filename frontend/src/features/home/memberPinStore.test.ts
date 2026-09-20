import { afterEach, describe, expect, it } from "vitest";

import {
  PIN_STATUS_UNAVAILABLE_MESSAGE,
  clearPinSession,
  memberSessionToken,
  profilePinGate,
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

  it("로그인 상태에서는 서버 pinConfigured만 PIN 게이트로 쓰고, 누락은 잠근다", () => {
    writePinRecord({
      profileId: "local-only",
      saltB64: "c2FsdA==",
      hashB64: "aGFzaA==",
      iterations: 1,
      mustChange: false,
      failedAttempts: 0,
      lockedUntil: null,
      role: "adult_member",
    });
    expect(profilePinGate({ id: "server-pin" }, true)).toBe("blocked");
    expect(profilePinGate({ id: "server-pin", pinConfigured: "unknown" }, true)).toBe("blocked");
    expect(profilePinGate({ id: "server-pin", pinConfigured: true }, true)).toBe("challenge");
    expect(profilePinGate({ id: "local-only", pinConfigured: false }, true)).toBe("open");
    expect(profilePinGate({ id: "local-only" }, false)).toBe("challenge");
    expect(profilePinGate({ id: "no-local" }, false)).toBe("open");
    expect(PIN_STATUS_UNAVAILABLE_MESSAGE).toContain("새로고침");
  });
});
