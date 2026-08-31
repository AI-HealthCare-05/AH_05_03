import type { HealthRecordType } from "../../shared/local/domainContracts";

/**
 * 개인 건강정보가 실제로 필요한 질문에만 최소 종류의 기록을 선택한다.
 * 기록 입력, 일반 인사, 단순 목록/차트 조회는 로컬 기능으로 처리하므로
 * 과거 기록을 외부 AI 컨텍스트에 포함하지 않는다.
 */
export function selectContextRecordTypes(message: string): HealthRecordType[] {
  const normalized = message.trim().toLowerCase();
  const selected = new Set<HealthRecordType>();
  const looksLikeAdvice =
    /(괜찮|해도\s*돼|해도\s*됨|먹어도|마셔도|피해야|주의|위험|문제|추천|어떻게\s*해야)/.test(normalized);

  if (!looksLikeAdvice) return [];
  if (/(술|음주|알코올|약|복용|타이레놀|진통제|항생제)/.test(normalized)) selected.add("medication");
  if (/(혈압|맥박)/.test(normalized)) selected.add("blood_pressure");
  if (/(혈당|당뇨|공복)/.test(normalized)) selected.add("blood_glucose");
  if (/(통증|아프|욱신|저리|쑤셔)/.test(normalized)) selected.add("pain");
  if (/(운동|헬스|달리|걷기)/.test(normalized)) {
    selected.add("exercise");
    selected.add("walking");
  }

  return [...selected];
}
