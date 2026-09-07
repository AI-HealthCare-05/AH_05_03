import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PENDING_INVITATION_STORAGE_KEY,
  getPendingInvitation,
  readAndPreserveInvitation,
  removePendingInvitation,
  savePendingInvitation,
} from "./invitationStorage";

describe("invitationStorage", () => {
  beforeEach(() => {
    window.localStorage?.clear();
    window.location.hash = "";
  });

  afterEach(() => {
    window.localStorage?.clear();
    window.location.hash = "";
  });

  it("savePendingInvitation and getPendingInvitation", () => {
    savePendingInvitation({
      invitationId: "inv-123",
      token: "tok-abc",
      email: "test@example.com",
    });

    const pending = getPendingInvitation();
    expect(pending).toBeDefined();
    expect(pending?.invitationId).toBe("inv-123");
    expect(pending?.token).toBe("tok-abc");
    expect(pending?.email).toBe("test@example.com");
  });

  it("removePendingInvitation removes stored item", () => {
    savePendingInvitation({
      invitationId: "inv-123",
      token: "tok-abc",
    });
    expect(getPendingInvitation()).toBeDefined();

    removePendingInvitation();
    expect(getPendingInvitation()).toBeUndefined();
  });

  it("readAndPreserveInvitation extracts from hash and preserves in localStorage", () => {
    window.location.hash = "#invitation=inv-456&token=tok-xyz&email=user%40test.com";

    const extracted = readAndPreserveInvitation();
    expect(extracted).toEqual({
      invitationId: "inv-456",
      token: "tok-xyz",
      email: "user@test.com",
    });

    // Verify it is saved to localStorage
    const saved = getPendingInvitation();
    expect(saved?.invitationId).toBe("inv-456");
    expect(saved?.token).toBe("tok-xyz");
    expect(saved?.email).toBe("user@test.com");
  });

  it("readAndPreserveInvitation falls back to localStorage when hash has no invitation", () => {
    savePendingInvitation({
      invitationId: "inv-789",
      token: "tok-fallback",
      email: "fallback@test.com",
    });

    // Hash has password reset token instead
    window.location.hash = "#reset_token=abc";

    const extracted = readAndPreserveInvitation();
    expect(extracted).toEqual({
      invitationId: "inv-789",
      token: "tok-fallback",
      email: "fallback@test.com",
    });
  });

  it("ignores expired items (>7 days)", () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    window.localStorage?.setItem(
      PENDING_INVITATION_STORAGE_KEY,
      JSON.stringify({
        invitationId: "inv-old",
        token: "tok-old",
        savedAt: eightDaysAgo,
      }),
    );

    expect(getPendingInvitation()).toBeUndefined();
  });
});
