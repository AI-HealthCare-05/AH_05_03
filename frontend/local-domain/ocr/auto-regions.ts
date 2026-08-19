/**
 * 열 위치 자동 탐지.
 *
 * 좌표를 박아두면 문서마다 다시 재야 한다. 대신 1차 전체 인식에서
 * 사전에 걸리는 라벨의 위치로 라벨 열을, 그 오른쪽 숫자 뭉치로 값 열을 찾는다.
 *
 * 값 열을 따로 뽑는 이유는 두 가지다.
 *  - 숫자 화이트리스트를 걸 수 있다 (6.1을 b.1로 읽는 사고가 사라진다)
 *  - 적색 채널만 남겨 형광펜을 걷어낼 수 있다
 */

import type { OcrWord, Rect } from "./types";
import { matchLabel } from "./checkup-lexicon";

export interface DetectedLayout {
  /** 사전에 걸린 라벨들 */
  labels: Array<{ code: string; y: number; similarity: number; confidence: number; raw: string }>;
  /** 값 열 추정 영역. 못 찾으면 null */
  valueColumn: Rect | null;
  /** 라벨 대비 값의 세로 오프셋 중앙값. 값이 위면 양수 */
  verticalOffset: number;
}

const isNumeric = (t: string): boolean => /^\d{1,4}(\.\d{1,2})?$/.test(t.replace(/[^\d.]/g, ""));

/**
 * 같은 줄에서 가로로 붙어 있는 조각만 이어 붙인다.
 *
 * Tesseract는 "HDL-콜레스테롤"을 "HDL-" + "콜레스테롤"로, 한글은 낱자로도 끊는다.
 * 그렇다고 줄 전체를 병합하면 옆 열(단위·판정·참고치)까지 딸려와 매칭이 깨진다.
 * y가 같고 x 간격이 글자 하나 폭 이내인 것만 붙인다.
 */
export function mergeAdjacent(words: OcrWord[], yTol = 16, gapRatio = 1.2): OcrWord[] {
  const sorted = [...words].filter((w) => w.text.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const out: OcrWord[] = [];

  for (const w of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.y - w.y) <= yTol) {
      const prevEnd = prev.x + (prev.width ?? 0);
      // 글자 하나 폭을 기준선으로 삼는다
      const charWidth = (prev.width ?? 0) / Math.max(1, prev.text.length);
      const gap = w.x - prevEnd;
      if (gap >= -charWidth && gap <= charWidth * gapRatio) {
        prev.text += w.text;
        prev.width = w.x + (w.width ?? 0) - prev.x;
        prev.confidence = Math.min(prev.confidence, w.confidence);
        continue;
      }
    }
    out.push({ ...w });
  }
  return out;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param passes    PSM별 1차 인식 결과. 각 패스를 따로 병합한다.
 *                  한 배열에 합쳐 병합하면 같은 글자가 두 번 이어붙어
 *                  "혈청크레아티닌"이 "레아아티"처럼 망가진다.
 * @param pageSize  원본 크기
 */
export function detectLayout(passes: OcrWord[][], pageSize: { width: number; height: number }): DetectedLayout {
  const words = passes.flat();
  const mergedPerPass = passes.flatMap((p) => mergeAdjacent(p));

  // 1) 인접 조각을 붙인 뒤 사전에 걸리는 라벨을 모은다
  const labels: DetectedLayout["labels"] = [];
  for (const w of mergedPerPass) {
    const m = matchLabel(w.text);
    if (m) labels.push({ code: m.item.code, y: w.y, similarity: m.similarity, confidence: w.confidence, raw: w.text });
  }
  // 같은 항목이 여러 번 걸리면 유사도가 높은 쪽만 남긴다
  const bestByCode = new Map<string, (typeof labels)[number]>();
  for (const l of labels) {
    const prev = bestByCode.get(l.code);
    if (!prev || l.similarity > prev.similarity) bestByCode.set(l.code, l);
  }
  const uniqueLabels = [...bestByCode.values()].sort((a, b) => a.y - b.y);

  if (uniqueLabels.length < 2) {
    return { labels: uniqueLabels, valueColumn: null, verticalOffset: 0 };
  }

  // 2) 라벨 y 근처(±행높이 절반)에 있는 숫자 토큰을 모아 x 분포를 본다
  const rowGap = median(uniqueLabels.slice(1).map((l, i) => l.y - uniqueLabels[i].y)) || 60;
  const band = rowGap * 0.7;

  const numericNearRows = words.filter(
    (w) => isNumeric(w.text) && uniqueLabels.some((l) => Math.abs(l.y - w.y) <= band),
  );
  if (!numericNearRows.length) {
    return { labels: uniqueLabels, valueColumn: null, verticalOffset: 0 };
  }

  // 3) x를 클러스터링해 가장 왼쪽의 큰 뭉치를 값 열로 본다.
  //    참고치 열(0~200 같은 범위 표기)은 보통 더 오른쪽에 있고 '~'가 붙어 걸러진다.
  const labelMaxX = Math.max(...uniqueLabels.map((l) => words.find((w) => w.text === l.raw)?.x ?? 0));
  const candidates = numericNearRows.filter((w) => w.x > labelMaxX);
  const pool = candidates.length >= 2 ? candidates : numericNearRows;

  const clusters: Array<{ xs: number[] }> = [];
  for (const w of [...pool].sort((a, b) => a.x - b.x)) {
    const last = clusters[clusters.length - 1];
    if (last && w.x - last.xs[last.xs.length - 1] <= pageSize.width * 0.06) last.xs.push(w.x);
    else clusters.push({ xs: [w.x] });
  }
  clusters.sort((a, b) => b.xs.length - a.xs.length || a.xs[0] - b.xs[0]);
  const chosen = clusters[0];

  const lo = Math.min(...chosen.xs);
  const hi = Math.max(...chosen.xs);
  const pad = pageSize.width * 0.035;
  const top = Math.max(0, uniqueLabels[0].y - rowGap);
  const bottom = Math.min(pageSize.height, uniqueLabels[uniqueLabels.length - 1].y + rowGap);

  const valueColumn: Rect = {
    left: Math.max(0, Math.round(lo - pad)),
    top: Math.round(top),
    width: Math.round(Math.min(pageSize.width - Math.max(0, lo - pad), hi - lo + pad * 2.4)),
    height: Math.round(bottom - top),
  };

  // 4) 라벨 대비 값의 세로 오프셋을 실측한다. 문서마다 다르다
  const offsets: number[] = [];
  for (const l of uniqueLabels) {
    const near = pool
      .filter((w) => w.x >= valueColumn.left && w.x <= valueColumn.left + valueColumn.width)
      .map((w) => ({ w, dy: l.y - w.y }))
      .filter((c) => Math.abs(c.dy) <= band)
      .sort((a, b) => Math.abs(a.dy) - Math.abs(b.dy))[0];
    if (near) offsets.push(near.dy);
  }

  return { labels: uniqueLabels, valueColumn, verticalOffset: Math.round(median(offsets)) };
}
