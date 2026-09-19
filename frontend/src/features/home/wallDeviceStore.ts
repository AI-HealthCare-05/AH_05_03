const BINDING_KEY = "ieobom:wall-device";
const REF_KEY = "ieobom:wall-device-ref";

export type WallDeviceBinding = {
  householdId: string;
  deviceId: string;
  deviceToken: string;
  displayName: string;
};

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readWallDevice(): WallDeviceBinding | undefined {
  const raw = storage()?.getItem(BINDING_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as WallDeviceBinding;
  } catch {
    return undefined;
  }
}

export function writeWallDevice(binding: WallDeviceBinding): void {
  storage()?.setItem(BINDING_KEY, JSON.stringify(binding));
}

export function clearWallDevice(): void {
  storage()?.removeItem(BINDING_KEY);
}

export function wallDeviceRef(): string {
  const existing = storage()?.getItem(REF_KEY);
  if (existing && /^[A-Za-z0-9_-]{43,86}$/.test(existing)) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const generated = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  storage()?.setItem(REF_KEY, generated);
  return generated;
}
