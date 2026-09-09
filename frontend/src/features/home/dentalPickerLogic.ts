export type DentalQuadrant = "upper-right" | "upper-left" | "lower-left" | "lower-right";
export type ToothType = "incisor" | "canine" | "premolar" | "molar" | "wisdom";

export interface ToothDefinition {
  fdiNumber: number; // 11 ~ 48
  quadrant: DentalQuadrant;
  type: ToothType;
  koreanName: string; // 예: "상악 우측 제1대구치"
  commonName: string; // 예: "오른쪽 위 첫째 큰어금니"
  shortCode: string; // 예: "#16"
  approxPoint: [number, number, number]; // 모델 3D 머리/구강 기준 대략적 좌표
}

/**
 * 성인 영구치 32개 FDI 표준 목록
 */
export const ADULT_TEETH: ToothDefinition[] = [
  // Quadrant 1: 상악 우측 (환자 기준 우측, 18 -> 11)
  { fdiNumber: 18, quadrant: "upper-right", type: "wisdom", koreanName: "상악 우측 제3대구치(사랑니)", commonName: "오른쪽 위 사랑니", shortCode: "#18", approxPoint: [0.03, 1.62, 0.05] },
  { fdiNumber: 17, quadrant: "upper-right", type: "molar", koreanName: "상악 우측 제2대구치", commonName: "오른쪽 위 둘째 큰어금니", shortCode: "#17", approxPoint: [0.028, 1.62, 0.06] },
  { fdiNumber: 16, quadrant: "upper-right", type: "molar", koreanName: "상악 우측 제1대구치", commonName: "오른쪽 위 첫째 큰어금니", shortCode: "#16", approxPoint: [0.025, 1.62, 0.07] },
  { fdiNumber: 15, quadrant: "upper-right", type: "premolar", koreanName: "상악 우측 제2소구치", commonName: "오른쪽 위 작은어금니", shortCode: "#15", approxPoint: [0.022, 1.62, 0.08] },
  { fdiNumber: 14, quadrant: "upper-right", type: "premolar", koreanName: "상악 우측 제1소구치", commonName: "오른쪽 위 작은어금니", shortCode: "#14", approxPoint: [0.018, 1.62, 0.085] },
  { fdiNumber: 13, quadrant: "upper-right", type: "canine", koreanName: "상악 우측 견치(송곳니)", commonName: "오른쪽 위 송곳니", shortCode: "#13", approxPoint: [0.014, 1.62, 0.09] },
  { fdiNumber: 12, quadrant: "upper-right", type: "incisor", koreanName: "상악 우측 측절치", commonName: "오른쪽 위 작은앞니", shortCode: "#12", approxPoint: [0.008, 1.62, 0.095] },
  { fdiNumber: 11, quadrant: "upper-right", type: "incisor", koreanName: "상악 우측 중절치", commonName: "오른쪽 위 대문니(앞니)", shortCode: "#11", approxPoint: [0.002, 1.62, 0.098] },

  // Quadrant 2: 상악 좌측 (환자 기준 좌측, 21 -> 28)
  { fdiNumber: 21, quadrant: "upper-left", type: "incisor", koreanName: "상악 좌측 중절치", commonName: "왼쪽 위 대문니(앞니)", shortCode: "#21", approxPoint: [-0.002, 1.62, 0.098] },
  { fdiNumber: 22, quadrant: "upper-left", type: "incisor", koreanName: "상악 좌측 측절치", commonName: "왼쪽 위 작은앞니", shortCode: "#22", approxPoint: [-0.008, 1.62, 0.095] },
  { fdiNumber: 23, quadrant: "upper-left", type: "canine", koreanName: "상악 좌측 견치(송곳니)", commonName: "왼쪽 위 송곳니", shortCode: "#23", approxPoint: [-0.014, 1.62, 0.09] },
  { fdiNumber: 24, quadrant: "upper-left", type: "premolar", koreanName: "상악 좌측 제1소구치", commonName: "왼쪽 위 작은어금니", shortCode: "#24", approxPoint: [-0.018, 1.62, 0.085] },
  { fdiNumber: 25, quadrant: "upper-left", type: "premolar", koreanName: "상악 좌측 제2소구치", commonName: "왼쪽 위 작은어금니", shortCode: "#25", approxPoint: [-0.022, 1.62, 0.08] },
  { fdiNumber: 26, quadrant: "upper-left", type: "molar", koreanName: "상악 좌측 제1대구치", commonName: "왼쪽 위 첫째 큰어금니", shortCode: "#26", approxPoint: [-0.025, 1.62, 0.07] },
  { fdiNumber: 27, quadrant: "upper-left", type: "molar", koreanName: "상악 좌측 제2대구치", commonName: "왼쪽 위 둘째 큰어금니", shortCode: "#27", approxPoint: [-0.028, 1.62, 0.06] },
  { fdiNumber: 28, quadrant: "upper-left", type: "wisdom", koreanName: "상악 좌측 제3대구치(사랑니)", commonName: "왼쪽 위 사랑니", shortCode: "#28", approxPoint: [-0.03, 1.62, 0.05] },

  // Quadrant 4: 하악 우측 (환자 기준 우측, 48 -> 41)
  { fdiNumber: 48, quadrant: "lower-right", type: "wisdom", koreanName: "하악 우측 제3대구치(사랑니)", commonName: "오른쪽 아래 사랑니", shortCode: "#48", approxPoint: [0.028, 1.58, 0.05] },
  { fdiNumber: 47, quadrant: "lower-right", type: "molar", koreanName: "하악 우측 제2대구치", commonName: "오른쪽 아래 둘째 큰어금니", shortCode: "#47", approxPoint: [0.026, 1.58, 0.06] },
  { fdiNumber: 46, quadrant: "lower-right", type: "molar", koreanName: "하악 우측 제1대구치", commonName: "오른쪽 아래 첫째 큰어금니", shortCode: "#46", approxPoint: [0.024, 1.58, 0.07] },
  { fdiNumber: 45, quadrant: "lower-right", type: "premolar", koreanName: "하악 우측 제2소구치", commonName: "오른쪽 아래 작은어금니", shortCode: "#45", approxPoint: [0.020, 1.58, 0.08] },
  { fdiNumber: 44, quadrant: "lower-right", type: "premolar", koreanName: "하악 우측 제1소구치", commonName: "오른쪽 아래 작은어금니", shortCode: "#44", approxPoint: [0.016, 1.58, 0.085] },
  { fdiNumber: 43, quadrant: "lower-right", type: "canine", koreanName: "하악 우측 견치(송곳니)", commonName: "오른쪽 아래 송곳니", shortCode: "#43", approxPoint: [0.012, 1.58, 0.09] },
  { fdiNumber: 42, quadrant: "lower-right", type: "incisor", koreanName: "하악 우측 측절치", commonName: "오른쪽 아래 작은앞니", shortCode: "#42", approxPoint: [0.007, 1.58, 0.095] },
  { fdiNumber: 41, quadrant: "lower-right", type: "incisor", koreanName: "하악 우측 중절치", commonName: "오른쪽 아래 대문니(앞니)", shortCode: "#41", approxPoint: [0.002, 1.58, 0.098] },

  // Quadrant 3: 하악 좌측 (환자 기준 좌측, 31 -> 38)
  { fdiNumber: 31, quadrant: "lower-left", type: "incisor", koreanName: "하악 좌측 중절치", commonName: "왼쪽 아래 대문니(앞니)", shortCode: "#31", approxPoint: [-0.002, 1.58, 0.098] },
  { fdiNumber: 32, quadrant: "lower-left", type: "incisor", koreanName: "하악 좌측 측절치", commonName: "왼쪽 아래 작은앞니", shortCode: "#32", approxPoint: [-0.007, 1.58, 0.095] },
  { fdiNumber: 33, quadrant: "lower-left", type: "canine", koreanName: "하악 좌측 견치(송곳니)", commonName: "왼쪽 아래 송곳니", shortCode: "#33", approxPoint: [-0.012, 1.58, 0.09] },
  { fdiNumber: 34, quadrant: "lower-left", type: "premolar", koreanName: "하악 좌측 제1소구치", commonName: "왼쪽 아래 작은어금니", shortCode: "#34", approxPoint: [-0.016, 1.58, 0.085] },
  { fdiNumber: 35, quadrant: "lower-left", type: "premolar", koreanName: "하악 좌측 제2소구치", commonName: "왼쪽 아래 작은어금니", shortCode: "#35", approxPoint: [-0.020, 1.58, 0.08] },
  { fdiNumber: 36, quadrant: "lower-left", type: "molar", koreanName: "하악 좌측 제1대구치", commonName: "왼쪽 아래 첫째 큰어금니", shortCode: "#36", approxPoint: [-0.024, 1.58, 0.07] },
  { fdiNumber: 37, quadrant: "lower-left", type: "molar", koreanName: "하악 좌측 제2대구치", commonName: "왼쪽 아래 둘째 큰어금니", shortCode: "#37", approxPoint: [-0.026, 1.58, 0.06] },
  { fdiNumber: 38, quadrant: "lower-left", type: "wisdom", koreanName: "하악 좌측 제3대구치(사랑니)", commonName: "왼쪽 아래 사랑니", shortCode: "#38", approxPoint: [-0.028, 1.58, 0.05] },
];

/**
 * FDI 치아 번호로 치아 정보 검색
 */
export function getToothByFdi(fdiNumber: number): ToothDefinition | undefined {
  return ADULT_TEETH.find((t) => t.fdiNumber === fdiNumber);
}

/**
 * 분면(Quadrant)별 치아 목록 정렬 반환
 */
export function getTeethByQuadrant(quadrant: DentalQuadrant): ToothDefinition[] {
  return ADULT_TEETH.filter((t) => t.quadrant === quadrant);
}

/**
 * 메쉬 이름 또는 자연어 검색어에서 치아 번호/정보 매칭
 */
export function matchToothFromQuery(query: string): ToothDefinition | undefined {
  const normalized = query.trim().toLowerCase();

  // 1. FDI 번호 직접 매칭 (예: "16", "#16", "tooth 16")
  const fdiMatch = normalized.match(/#?([1-4][1-8])/);
  if (fdiMatch) {
    const fdi = parseInt(fdiMatch[1], 10);
    const found = getToothByFdi(fdi);
    if (found) return found;
  }

  // 2. 키워드 매칭
  for (const tooth of ADULT_TEETH) {
    const cleanKorean = tooth.koreanName.toLowerCase().replace(/[()]/g, " ");
    const cleanCommon = tooth.commonName.toLowerCase().replace(/[()]/g, " ");

    if (
      normalized.includes(tooth.shortCode.toLowerCase()) ||
      cleanKorean.includes(normalized) ||
      normalized.includes(cleanKorean) ||
      cleanCommon.includes(normalized) ||
      normalized.includes(cleanCommon)
    ) {
      return tooth;
    }
  }

  return undefined;
}
