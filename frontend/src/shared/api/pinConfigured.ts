export function parseServerPinConfigured(value: unknown): boolean | "unknown" {
  return typeof value === "boolean" ? value : "unknown";
}
