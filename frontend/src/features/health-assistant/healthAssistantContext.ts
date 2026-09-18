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
    /(괜찮|도\s*돼|도\s*됨|먹어도|마셔도|피워도|피해야|주의|위험|문제|추천|어떻게\s*해야|어때|궁금|알려줘|어디가|조심|분석해|상태|기록|검진|결과|만성질환)/.test(normalized);
  if (!looksLikeAdvice) return [];
  if (/(술|음주|알코올|약|복용|타이레놀|진통제|항생제)/.test(normalized)) {
    selected.add("medication");
    // [P1 #6] 술(음주) 관련 질문일 때 과거 건강검진/검사 결과 교차 검증을 위해 추가
    if (/(술|음주|알코올)/.test(normalized)) {
      selected.add("health_screening");
      selected.add("lab_result");
      selected.add("blood_glucose");
    }
  }
  if (/(혈압|맥박)/.test(normalized)) selected.add("blood_pressure");
  if (/(혈당|당뇨|공복)/.test(normalized)) selected.add("blood_glucose");
  if (/(통증|아프|욱신|저리|쑤셔)/.test(normalized)) selected.add("pain");
  if (/(운동|헬스|달리|걷기)/.test(normalized)) {
    selected.add("exercise");
    selected.add("walking");
  }
  if (/(간수치|간기능|ast|alt|ggt|콜레스테롤|검진|결과지|피검사|혈액검사|검사결과|어디가|조심|어때|궁금|분석해|상태|기록|만성질환)/.test(normalized)) {
    selected.add("health_screening");
    selected.add("lab_result");
  }

  return [...selected];
}
