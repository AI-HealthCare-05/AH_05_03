/**
 * 검진표 행 조립 — 엔진에 의존하지 않는 순수 로직.
 *
 * 왜 줄 단위 인식으로는 안 되는가:
 * 실제 결과지(sample.jpeg)에서 값은 라벨보다 약 20px 위에 찍혀 있고,
 * 판정·참고치 열은 또 다르게 밀려 있다. OCR 엔진은 가로 줄로 묶기 때문에
 * 라벨과 값의 짝이 어긋난다. 그래서 열을 따로 읽고 y좌표로 다시 붙인다.
 */

import type { ExtractedRow, OcrWord } from "./types";
import { matchLabel, parseValue } from "./checkup-lexicon";

/** 값이 라벨보다 위에 찍히는 정도. sample.jpeg 실측 평균 20px */
export const DEFAULT_LABEL_VALUE_OFFSET = 20;
/** 짝짓기 허용 밴드. 이 밖이면 다른 행으로 본다 */
export const DEFAULT_PAIR_BAND = { min: -10, max: 45 };
/**
 * 자동 확정 임계값.
 * sample.jpeg 실측에서 80으로 자르면 오답이 자동확정된 건수가 0이었다.
 * 낮추면 오인식이 그대로 통과하고, 높이면 검수할 항목만 늘어난다.
 */
export const DEFAULT_REVIEW_THRESHOLD = 80;

export interface MergedLine {
  y: number;
  text: string;
  confidence: number;
}

/**
 * 글자 단위로 쪼개진 조각을 한 줄로 병합한다.
 * Tesseract는 한글을 "크"/"레"/"아"/"티"/"닌"처럼 낱자로 끊는 경우가 잦다.
 */
export function mergeLines(words: OcrWord[], tolerance = 14): MergedLine[] {
  const buckets: Array<{ y: number; parts: OcrWord[] }> = [];

  for (const w of [...words].sort((a, b) => a.y - b.y)) {
    if (!w.text.trim()) continue;
    const bucket = buckets.find((b) => Math.abs(b.y - w.y) <= tolerance);
    if (bucket) {
      bucket.parts.push(w);
      bucket.y = bucket.parts.reduce((s, p) => s + p.y, 0) / bucket.parts.length;
    } else {
      buckets.push({ y: w.y, parts: [w] });
    }
  }

  return buckets.map((b) => {
    const parts = [...b.parts].sort((x, y) => x.x - y.x);
    return {
      y: b.y,
      text: parts.map((p) => p.text).join(""),
      confidence: Math.min(...parts.map((p) => p.confidence)),
    };
  });
}

export interface PairOptions {
  offset?: number;
  band?: { min: number; max: number };
  reviewThreshold?: number;
}

/**
 * 라벨 열과 값 열을 y좌표로 짝짓는다.
 *
 * 매칭·파싱에 실패하거나 신뢰도가 임계값 미만인 행은 needsReview=true로 표시한다.
 * 이 플래그가 곧 화면의 "확인 필요" 표시가 된다 (DESIGN.md §4 OCR 검수 오버레이).
 */
export function pairRows(
  labelWords: OcrWord[],
  valueWords: OcrWord[],
  options: PairOptions = {},
): ExtractedRow[] {
  const offset = options.offset ?? DEFAULT_LABEL_VALUE_OFFSET;
  const band = options.band ?? DEFAULT_PAIR_BAND;
  const threshold = options.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD;

  const labelLines = mergeLines(labelWords);
  const numeric = valueWords
    .map((w) => ({ ...w, text: w.text.replace(/[^\d.]/g, "").replace(/^\.+|\.+$/g, "") }))
    .filter((w) => /^\d+(\.\d+)?$/.test(w.text));

  const used = new Set<OcrWord>();
  const rows: ExtractedRow[] = [];

  for (const line of labelLines) {
    const match = matchLabel(line.text);

    // 값 후보 중 y가 가장 그럴듯한 것 하나를 고른다
    let picked: { word: OcrWord; distance: number } | null = null;
    for (const v of numeric) {
      if (used.has(v)) continue;
      const dy = line.y - v.y;
      if (dy < band.min || dy > band.max) continue;
      const distance = Math.abs(dy - offset);
      if (!picked || distance < picked.distance) picked = { word: v, distance };
    }
    if (picked) used.add(picked.word);

    const rawValue = picked?.word.text ?? null;
    const value = match && rawValue !== null ? parseValue(match.item, rawValue) : null;
    const confidence = Math.min(line.confidence, picked?.word.confidence ?? 0);

    // 라벨을 못 붙였거나, 값을 못 읽었거나, 신뢰도가 낮으면 사람이 봐야 한다
    const needsReview = !match || value === null || confidence < threshold;

    rows.push({
      itemCode: match?.item.code ?? null,
      rawLabel: line.text,
      labelSimilarity: match?.similarity ?? 0,
      value,
      rawValue,
      confidence: Math.round(confidence),
      needsReview,
    });
  }

  return rows;
}

/** 결과지에서 검진일을 찾는다. YYYY-MM-DD 또는 YYYY.MM.DD */
export function findMeasuredDate(words: OcrWord[]): string | null {
  const joined = words.map((w) => w.text).join(" ");
  const m = joined.match(/(20\d{2})[-.\s/](\d{1,2})[-.\s/](\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
