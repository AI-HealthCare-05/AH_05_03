const STORAGE_PREFIX = "ieobom_home_region:";

export const ALLOW_GPS_CHIP = "현재 위치 허용";
export const PICK_OTHER_REGION_CHIP = "다른 지역 선택";
export const AREA_VIEW_SUFFIX = " 기준으로 보기";
export const QUICK_REGIONS = ["서울", "하남시", "성남시", "수원시", "인천", "부산"] as const;

export function areaViewChip(region: string): string {
  return `${region}${AREA_VIEW_SUFFIX}`;
}

export function parseAreaViewChip(label: string): string | null {
  if (!label.endsWith(AREA_VIEW_SUFFIX)) return null;
  const region = label.slice(0, -AREA_VIEW_SUFFIX.length).trim();
  return region || null;
}

export function readHomeRegion(profileId: string): string | null {
  try {
    const value = localStorage.getItem(`${STORAGE_PREFIX}${profileId}`)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function writeHomeRegion(profileId: string, region: string): void {
  const trimmed = region.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${profileId}`, trimmed);
  } catch {
    // 저장 실패해도 이번 질문에는 home_region 을 실어 보낼 수 있다.
  }
}

export function isLocationChoiceChip(label: string): boolean {
  return label === ALLOW_GPS_CHIP || label === PICK_OTHER_REGION_CHIP || parseAreaViewChip(label) !== null;
}
