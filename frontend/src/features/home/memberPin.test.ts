import { describe, expect, it } from "vitest";

import { createPinRecord, generateTemporaryPin, isWeakPin, roleFromRelationship, roleLabel, verifyPin } from "./memberPin";

describe("memberPin", () => {
  it("연속 숫자와 생년월일 PIN을 거절한다", () => {
    expect(isWeakPin("123456")).toBe(true);
    expect(isWeakPin("000000")).toBe(true);
    expect(isWeakPin("199001", "1990-01-15")).toBe(true);
    expect(isWeakPin("482913")).toBe(false);
  });

  it("역할 라벨을 관계에서 고른다", () => {
    expect(roleFromRelationship("자녀")).toBe("self_only");
    expect(roleLabel("self_only")).toBe("자기 기록만");
    expect(roleLabel("adult_member")).toBe("성인");
  });

  it("임시 PIN을 해시로만 보관하고 원문과 대조한다", async () => {
    const pin = generateTemporaryPin();
    const record = await createPinRecord("profile-1", pin, "self_only");
    expect(record.hashB64).not.toContain(pin);
    expect(record.mustChange).toBe(true);
    const ok = await verifyPin(record, pin);
    expect(ok.ok).toBe(true);
    const fail = await verifyPin(record, pin === "482913" ? "715204" : "482913");
    expect(fail.ok).toBe(false);
  });
});
