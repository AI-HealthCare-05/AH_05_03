import { describe, expect, it } from "vitest";

import { parseServerPinConfigured } from "./pinConfigured";
import { toClientProfile } from "./serverDomainRuntime";
import type { ProfileServerData } from "./contracts";

function sampleServer(overrides: Partial<ProfileServerData> = {}): ProfileServerData {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    household_id: "22222222-2222-2222-2222-222222222222",
    created_by_account_id: "33333333-3333-3333-3333-333333333333",
    display_name: "검증",
    relationship: "자녀",
    birth_date: null,
    gender: null,
    status: "active",
    row_version: 1,
    created_at: "2026-09-20T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
    pin_configured: false,
    ...overrides,
  };
}

describe("toClientProfile PIN 상태", () => {
  it("boolean만 통과하고 누락은 unknown이다", () => {
    expect(parseServerPinConfigured(true)).toBe(true);
    expect(parseServerPinConfigured(false)).toBe(false);
    expect(parseServerPinConfigured(undefined)).toBe("unknown");
    expect(parseServerPinConfigured(null)).toBe("unknown");
    expect(toClientProfile(sampleServer({ pin_configured: true })).pinConfigured).toBe(true);
    expect(toClientProfile(sampleServer({ pin_configured: false })).pinConfigured).toBe(false);
    const legacy = { ...sampleServer(), pin_configured: undefined as unknown as boolean };
    delete (legacy as { pin_configured?: boolean }).pin_configured;
    expect(toClientProfile(legacy as ProfileServerData).pinConfigured).toBe("unknown");
  });
});
