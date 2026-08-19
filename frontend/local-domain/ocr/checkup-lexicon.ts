/**
 * 국가건강검진 결과지 항목 사전.
 *
 * OCR 정확도에 기대지 않기 위한 장치다. 항목명은 유한한 고정 집합이므로
 * 인식 결과를 퍼지 매칭으로 붙인다. "콜레스테를"처럼 한 글자가 틀려도 걸린다.
 *
 * `unit`·`range`는 확정 단계의 범위 검증에 쓴다. 의학적 정상 여부 판정이
 * 아니라 입력 형식 검증이다 (docs/10_local_data_contract.md §3.2).
 */

export interface CheckupItem {
  /** 표준 항목 코드 — HealthRecord payload의 testCode로 들어간다 */
  code: string;
  /** 화면 표기 */
  label: string;
  /** 결과지에 나타나는 표기 변형들 */
  aliases: string[];
  unit: string;
  /** 입력 허용 범위. 벗어나면 확정을 막는다 */
  min: number;
  max: number;
  /** 소수점 자릿수. 0이면 정수 */
  decimals: number;
}

export const CHECKUP_ITEMS: CheckupItem[] = [
  { code: "hdl_cholesterol",  label: "HDL콜레스테롤",   aliases: ["HDL콜레스테롤", "HDL-콜레스테롤", "HDL콜레스테롤(mg/dL)"], unit: "mg/dL", min: 5,   max: 200,  decimals: 0 },
  { code: "ldl_cholesterol",  label: "LDL콜레스테롤",   aliases: ["LDL콜레스테롤", "LDL-콜레스테롤"],                        unit: "mg/dL", min: 5,   max: 400,  decimals: 0 },
  { code: "total_cholesterol",label: "총콜레스테롤",    aliases: ["총콜레스테롤", "총콜레스톨"],                              unit: "mg/dL", min: 50,  max: 500,  decimals: 0 },
  { code: "triglyceride",     label: "트리글리세라이드", aliases: ["트리글리세라이드", "중성지방"],                            unit: "mg/dL", min: 10,  max: 1000, decimals: 0 },
  { code: "bun",              label: "요소질소",        aliases: ["요소질소", "혈중요소질소", "BUN"],                        unit: "mg/dL", min: 1,   max: 100,  decimals: 1 },
  { code: "creatinine",       label: "크레아티닌",      aliases: ["크레아티닌", "혈청크레아티닌"],                                            unit: "mg/dL", min: 0.1, max: 15,   decimals: 2 },
  { code: "uric_acid",        label: "요산",           aliases: ["요산"],                                                 unit: "mg/dL", min: 0.5, max: 20,   decimals: 1 },
  { code: "fasting_glucose",  label: "공복혈당",        aliases: ["공복혈당", "식전혈당", "공복시혈당"],                       unit: "mg/dL", min: 20,  max: 600,  decimals: 0 },
  { code: "systolic_bp",      label: "수축기혈압",      aliases: ["수축기혈압", "수축기"],                                   unit: "mmHg",  min: 40,  max: 300,  decimals: 0 },
  { code: "diastolic_bp",     label: "이완기혈압",      aliases: ["이완기혈압", "이완기"],                                   unit: "mmHg",  min: 20,  max: 200,  decimals: 0 },
  { code: "hemoglobin",       label: "혈색소",          aliases: ["혈색소", "헤모글로빈"],                                   unit: "g/dL",  min: 3,   max: 25,   decimals: 1 },
  { code: "ast",              label: "AST",           aliases: ["AST", "AST(SGOT)", "SGOT"],                             unit: "U/L",   min: 1,   max: 2000, decimals: 0 },
  { code: "alt",              label: "ALT",           aliases: ["ALT", "ALT(SGPT)", "SGPT"],                             unit: "U/L",   min: 1,   max: 2000, decimals: 0 },
  { code: "ggt",              label: "감마지티피",      aliases: ["감마지티피", "감마GTP", "γ-GTP"],                          unit: "U/L",   min: 1,   max: 2000, decimals: 0 },
];

const BY_CODE = new Map(CHECKUP_ITEMS.map((i) => [i.code, i]));
export const findItem = (code: string): CheckupItem | undefined => BY_CODE.get(code);

/** 정규화 — 공백·괄호·하이픈을 지우고 대문자로 맞춘다 */
export function normalize(raw: string): string {
  return raw.replace(/[^가-힣A-Za-z]/g, "").toUpperCase();
}

function levenshtein(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array<number>(b.length + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return d[a.length][b.length];
}

export interface LabelMatch {
  item: CheckupItem;
  similarity: number;
  matchedAlias: string;
}

/**
 * OCR 라벨을 사전 항목에 붙인다.
 *
 * HDL과 LDL은 한글 부분이 "콜레스테롤"로 같아서, 라틴 접두사가 깨지면
 * 서로 구분되지 않는다. 그 경우 유사도가 threshold를 넘더라도 두 후보의
 * 점수 차가 작으면 매칭을 포기한다 — 잘못 붙이는 것보다 사람에게 묻는 게 낫다.
 */
export function matchLabel(raw: string, threshold = 0.6): LabelMatch | null {
  const s = normalize(raw);
  if (s.length < 2) return null;

  const scored: LabelMatch[] = [];
  for (const item of CHECKUP_ITEMS) {
    let best: LabelMatch | null = null;
    for (const alias of item.aliases) {
      const a = normalize(alias);
      const similarity = 1 - levenshtein(s, a) / Math.max(s.length, a.length);
      if (!best || similarity > best.similarity) best = { item, similarity, matchedAlias: alias };
    }
    if (best) scored.push(best);
  }
  scored.sort((x, y) => y.similarity - x.similarity);

  const top = scored[0];
  if (!top) return null;

  // 짧은 토큰은 편집거리 1만 나도 유사도가 높게 나온다.
  // 실측에서 OCR 쓰레기값 "BUT"가 요소질소의 별칭 "BUN"에 67%로 붙었다.
  const minSimilarity = s.length <= 4 ? 0.85 : threshold;
  if (top.similarity < minSimilarity) return null;

  // 1·2위가 붙어 있으면 확정하지 않는다 (HDL/LDL 혼동 방지)
  const runnerUp = scored[1];
  if (runnerUp && top.similarity - runnerUp.similarity < 0.12) return null;

  return top;
}

/** 수치 문자열을 파싱하고 항목별 허용 범위로 검증한다 */
export function parseValue(item: CheckupItem, raw: string): number | null {
  const cleaned = raw.replace(/[^\d.]/g, "").replace(/^\.+|\.+$/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  if (n < item.min || n > item.max) return null;
  return n;
}
