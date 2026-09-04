/**
 * 측정 항목별로 받을 칸.
 *
 * `MeasureForm.tsx` 에 함께 두면 `react-refresh/only-export-components` 에 걸린다 —
 * 컴포넌트와 상수를 한 파일에서 내보내기 때문이다. 규칙이 안내하는 대로 나눴다.
 *
 * 키는 `assessment/snapshots.ts` 의 `TREND_SERIES` 와 같은 이름이다. 달라지면 같은
 * 체중이 두 계열로 갈려 추적 대시보드에서 선이 끊긴다.
 */

export interface MeasureField {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step?: string;
}

/** 측정 항목마다 받을 칸. 검진결과지 36필드 전부는 `/assessment` 가 맡는다. */
export const MEASURE_FIELDS: Record<string, MeasureField[]> = {
  weight: [
    { key: "weight_kg", label: "체중", unit: "kg", min: 20, max: 300, step: "0.1" },
    { key: "waist_cm", label: "허리둘레", unit: "cm", min: 40, max: 200, step: "0.1" },
  ],
  bp: [
    { key: "sbp", label: "수축기", unit: "mmHg", min: 60, max: 260 },
    { key: "dbp", label: "이완기", unit: "mmHg", min: 30, max: 200 },
  ],
  lab: [
    { key: "fasting_glucose", label: "공복혈당", unit: "mg/dL", min: 30, max: 600 },
    { key: "hba1c", label: "당화혈색소", unit: "%", min: 3, max: 20, step: "0.1" },
    { key: "total_chol", label: "총콜레스테롤", unit: "mg/dL", min: 50, max: 500 },
    { key: "hdl", label: "HDL", unit: "mg/dL", min: 10, max: 150 },
    { key: "ldl", label: "LDL", unit: "mg/dL", min: 10, max: 400 },
    { key: "triglyceride", label: "중성지방", unit: "mg/dL", min: 20, max: 1500 },
  ],
};
