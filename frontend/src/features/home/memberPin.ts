/**
 * 구성원 위임 PIN. 건강정보 DEK·계정 비밀번호가 아니다.
 * 이미 열린 가구 화면에서 지금 누구 권한으로 쓰는지만 가른다.
 */

export type MemberPinRole = "adult_member" | "self_only" | "restricted";

export type MemberPinRecord = {
  profileId: string;
  saltB64: string;
  hashB64: string;
  iterations: number;
  mustChange: boolean;
  failedAttempts: number;
  lockedUntil: number | null;
  role: MemberPinRole;
};

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MS = 5 * 60 * 1000;
export const PIN_SESSION_MS = 5 * 60 * 1000;

const COMMON_PINS = new Set(["000000", "111111", "123456", "654321", "123123", "112233", "121212"]);

export function roleFromRelationship(relationship: string): MemberPinRole {
  if (relationship === "자녀") return "self_only";
  if (relationship === "기타") return "restricted";
  return "adult_member";
}

export function roleLabel(role: MemberPinRole): string {
  if (role === "self_only") return "자기 기록만";
  if (role === "restricted") return "제한";
  return "성인";
}

export function isPinSessionFresh(unlockedAt: number, now = Date.now()): boolean {
  return now - unlockedAt < PIN_SESSION_MS;
}

export function isWeakPin(pin: string, birthDate?: string | null): boolean {
  if (!/^\d{6,}$/.test(pin)) return true;
  if (COMMON_PINS.has(pin.slice(0, 6)) && pin.length === 6) return true;
  if ([...pin].every((digit) => digit === pin[0])) return true;
  const digits = [...pin].map(Number);
  const sequentialUp = digits.every((digit, index) => index === 0 || digit === (digits[index - 1] + 1) % 10);
  const sequentialDown = digits.every((digit, index) => index === 0 || digit === (digits[index - 1] + 9) % 10);
  if (sequentialUp || sequentialDown) return true;
  if (birthDate) {
    const compact = birthDate.replaceAll("-", "");
    if (compact.length >= 6 && (pin === compact.slice(0, 6) || pin === compact.slice(-6) || pin === compact.slice(2, 8))) {
      return true;
    }
  }
  return false;
}

export function generateTemporaryPin(birthDate?: string | null): string {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
    const pin = String(value).padStart(6, "0");
    if (!isWeakPin(pin, birthDate)) return pin;
  }
  throw new Error("임시 PIN을 만들지 못했습니다.");
}

function pinIterations(): number {
  return import.meta.env.MODE === "test" ? 10 : 100_000;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveHash(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt.buffer as ArrayBuffer, iterations },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

export async function createPinRecord(
  profileId: string,
  pin: string,
  role: MemberPinRole,
  options?: { mustChange?: boolean; birthDate?: string | null },
): Promise<MemberPinRecord> {
  if (isWeakPin(pin, options?.birthDate)) {
    throw new Error("생년월일·연속 숫자처럼 쉬운 PIN은 쓸 수 없습니다.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = pinIterations();
  const hash = await deriveHash(pin, salt, iterations);
  return {
    profileId,
    saltB64: bytesToB64(salt),
    hashB64: bytesToB64(hash),
    iterations,
    mustChange: options?.mustChange ?? true,
    failedAttempts: 0,
    lockedUntil: null,
    role,
  };
}

export function pinLockRemainingMs(record: MemberPinRecord, now = Date.now()): number {
  if (!record.lockedUntil) return 0;
  return Math.max(0, record.lockedUntil - now);
}

export async function verifyPin(
  record: MemberPinRecord,
  pin: string,
  now = Date.now(),
): Promise<{ ok: true; record: MemberPinRecord } | { ok: false; record: MemberPinRecord; message: string }> {
  const remainingLock = pinLockRemainingMs(record, now);
  if (remainingLock > 0) {
    return { ok: false, record, message: `PIN이 잠겨 있습니다. ${Math.ceil(remainingLock / 1000)}초 뒤에 다시 시도하세요.` };
  }
  const salt = b64ToBytes(record.saltB64);
  const expected = b64ToBytes(record.hashB64);
  const actual = await deriveHash(pin, salt, record.iterations);
  const matches = actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
  if (matches) {
    return { ok: true, record: { ...record, failedAttempts: 0, lockedUntil: null } };
  }
  const failedAttempts = record.failedAttempts + 1;
  const locked = failedAttempts >= PIN_MAX_ATTEMPTS;
  return {
    ok: false,
    record: {
      ...record,
      failedAttempts,
      lockedUntil: locked ? now + PIN_LOCK_MS : null,
    },
    message: locked
      ? "PIN을 여러 번 틀려 잠시 잠겼습니다. 마스터가 재발급할 수 있습니다."
      : `PIN이 다릅니다. 남은 시도 ${PIN_MAX_ATTEMPTS - failedAttempts}회.`,
  };
}
