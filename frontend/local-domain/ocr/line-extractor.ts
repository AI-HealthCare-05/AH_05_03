/**
 * 줄 단위 행 추출.
 *
 * 처음에는 열을 따로 잘라 y좌표로 짝짓는 방식을 썼다. 실측해보니 불필요했다.
 * Tesseract의 줄 단위 출력은 "총콜레스테롤 185 mg/dL 정상 0~200"처럼
 * 한 행이 통째로 나온다. 단어 bbox를 재조립하면 오히려 낱자로 쪼개져 망가진다.
 *
 * 열 분리가 필요한 경우는 하나 남아 있다 — 라벨과 값이 세로로 어긋나게 인쇄된
 * 문서(sample.jpeg가 그렇다). 그때는 table-extractor.ts의 pairRows를 쓴다.
 */

import type { ExtractedRow } from "./types";
import { CHECKUP_ITEMS, findItem, matchLabel, normalize, parseValue } from "./checkup-lexicon";

export interface OcrLine {
  text: string;
  confidence: number;
  y: number;
}

export interface LineExtractOptions {
  reviewThreshold?: number;
}

/** 줄 앞머리에서 라벨로 볼 부분만 떼어낸다. 첫 숫자 앞까지. */
function splitLabelAndRest(text: string): { label: string; rest: string } {
  const m = text.match(/^(.*?)(\d[\d.,\s]*.*)$/s);
  if (!m) return { label: text.trim(), rest: "" };
  return { label: m[1].trim(), rest: m[2] };
}

/** 줄에서 결과값 후보를 고른다. 단위·참고치에 섞인 숫자를 피한다. */
function pickValue(rest: string): string | null {
  // 참고치는 "0~200", "13~16.5", "60 이상"처럼 물결이나 한글이 붙는다.
  // 첫 번째 독립 숫자를 결과값으로 본다.
  const tokens = rest.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (/[~-]/.test(t)) continue; // 범위 표기
    const cleaned = t.replace(/[^\d.]/g, "").replace(/^\.+|\.+$/g, "");
    if (/^\d{1,4}(\.\d{1,2})?$/.test(cleaned)) return cleaned;
  }
  return null;
}

/**
 * 줄 목록에서 검진 항목 행을 뽑는다.
 *
 * 같은 항목 코드는 한 번만 쓴다. "110[-콜레스테롤"(HDL 오인식)이 정규화되면
 * "콜레스테롤"만 남아 총콜레스테롤과 83%로 붙어버리는데, 총콜레스테롤이 이미
 * 100%로 확정돼 있으면 이 줄은 다음 후보로 밀리고 결국 애매해져 검수로 간다.
 * 잘못된 항목에 값을 꽂는 것보다 사람에게 묻는 쪽이 안전하다.
 */
export function extractRowsFromLines(lines: OcrLine[], options: LineExtractOptions = {}): ExtractedRow[] {
  const threshold = options.reviewThreshold ?? 80;

  // 1) 줄마다 라벨 후보와 값 후보를 만든다
  const candidates = lines
    .map((line) => {
      const { label, rest } = splitLabelAndRest(line.text.replace(/\n/g, " "));
      if (normalize(label).length < 2) return null;
      return { line, rawLabel: label, rawValue: pickValue(rest), match: matchLabel(label) };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  // 2) 유사도 높은 순으로 코드를 한 번씩만 배정한다
  const taken = new Set<string>();
  const assigned = new Map<(typeof candidates)[number], string>();
  for (const c of [...candidates].sort((a, b) => (b.match?.similarity ?? 0) - (a.match?.similarity ?? 0))) {
    const code = c.match?.item.code;
    if (!code || taken.has(code)) continue;
    taken.add(code);
    assigned.set(c, code);
  }

  // 3) 행 조립
  const rows: ExtractedRow[] = [];
  for (const c of candidates) {
    const code = assigned.get(c) ?? null;
    if (!code && !c.rawValue) continue; // 표와 무관한 줄

    const item = code ? findItem(code) : undefined;
    const value = item && c.rawValue ? parseValue(item, c.rawValue) : null;
    const confidence = Math.round(c.line.confidence);

    rows.push({
      itemCode: code,
      rawLabel: c.rawLabel,
      labelSimilarity: c.match?.similarity ?? 0,
      value,
      rawValue: c.rawValue,
      confidence,
      needsReview: !code || value === null || confidence < threshold,
    });
  }

  // 표 항목으로 보이는 행만 남긴다
  return rows.filter((r) => r.itemCode !== null || r.rawValue !== null);
}

/** 인식 결과에서 검진일을 찾는다 */
export function findMeasuredDateInLines(lines: OcrLine[]): string | null {
  for (const l of lines) {
    const m = l.text.match(/(20\d{2})[-.\s/](\d{1,2})[-.\s/](\d{1,2})/);
    if (!m) continue;
    const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    if (!Number.isNaN(Date.parse(iso))) return iso;
  }
  return null;
}

export const KNOWN_ITEM_COUNT = CHECKUP_ITEMS.length;
