import type { CompoundOrganItem } from "./anatomyCompoundRegistry";

export type AnatomySearchSide = "left" | "right";

const SIDE_TOKEN_RE = /우측|좌측|오른쪽|왼쪽|\bright\b|\bleft\b/gi;

export function parseSearchSide(query: string): AnatomySearchSide | undefined {
  const compact = query.trim().toLowerCase().replace(/\s+/g, "");
  if (compact.includes("우측") || compact.includes("오른쪽") || /\bright\b/.test(query.toLowerCase())) {
    return "right";
  }
  if (compact.includes("좌측") || compact.includes("왼쪽") || /\bleft\b/.test(query.toLowerCase())) {
    return "left";
  }
  return undefined;
}

export function queryWithoutSide(query: string): string {
  return query.replace(SIDE_TOKEN_RE, " ").replace(/\s+/g, " ").trim();
}

export function childLaterality(childId: string): AnatomySearchSide | undefined {
  if (/-right$/i.test(childId)) return "right";
  if (/-left$/i.test(childId)) return "left";
  return undefined;
}

/** 메타데이터 part id → 공식 메쉬명 힌트 (`Suprarenal gland.r`, `Testis.l`). */
export function childOfficialMeshHint(childId: string, parentId?: string): string {
  const side = childLaterality(childId);
  let stem = childId.replace(/-right$|-left$/i, "");
  if (parentId && (stem === parentId || stem.startsWith(`${parentId}-`))) {
    stem = stem.slice(parentId.length).replace(/^-/, "");
  }
  const words = stem.split("-").filter(Boolean);
  const core = words.join(" ") || childId;
  if (side === "right") return `${core}.r`;
  if (side === "left") return `${core}.l`;
  return core;
}

export function sideKoreanPrefix(side: AnatomySearchSide): string {
  return side === "right" ? "우측 " : "좌측 ";
}

export function compoundCoversKorean(organ: CompoundOrganItem, korean: string): boolean {
  const needle = korean.trim().toLowerCase().replace(/[\s()（）]/g, "");
  if (!needle) return false;
  const title = organ.koreanName.split("(")[0].trim().toLowerCase().replace(/[\s()（）]/g, "");
  const full = organ.koreanName.toLowerCase().replace(/[\s()（）]/g, "");
  return needle === title || needle === full;
}

export function meshLooksLikeSide(meshName: string, anatomyId: string, side: AnatomySearchSide): boolean {
  const hay = `${meshName} ${anatomyId}`.toLowerCase();
  if (side === "right") {
    if (hay.includes("-left") || hay.includes(".l")) return false;
    return hay.includes("-right") || hay.includes(".r") || hay.includes(" right");
  }
  if (hay.includes("-right") || hay.includes(".r")) return false;
  return hay.includes("-left") || hay.includes(".l") || hay.includes(" left");
}
