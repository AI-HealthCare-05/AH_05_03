/**
 * 합성 픽스처 3종으로 OCR 파이프라인을 채점한다.
 * 실행: npx tsx scripts/score-fixtures.ts
 */
import { createWorker } from "tesseract.js";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { OcrLine } from "../local-domain/ocr/line-extractor";
import { extractRowsFromLines, findMeasuredDateInLines } from "../local-domain/ocr/line-extractor";
import { findItem } from "../local-domain/ocr/checkup-lexicon";
import { DEFAULT_REVIEW_THRESHOLD } from "../local-domain/ocr/table-extractor";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(HERE, "../fixtures");
const SCALE = 2;

interface ManifestEntry { id: string; title: string; file: string; measuredDate: string; truth: Record<string, number> }
const manifest: ManifestEntry[] = JSON.parse(readFileSync(resolve(FIX, "manifest.json"), "utf8"));

function lines(data: any, scale: number): OcrLine[] {
  const out: OcrLine[] = [];
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs ?? [])
      for (const l of p.lines ?? []) {
        const text = (l.text ?? "").replace(/\n/g, " ").trim();
        if (text) out.push({ text, confidence: l.confidence ?? 0, y: (l.bbox.y0 + l.bbox.y1) / 2 / scale });
      }
  return out;
}

const worker = await createWorker("kor+eng", 1);
const summary: Array<{ title: string; correct: number; total: number; auto: number; review: number; autoWrong: number; ms: number; date: boolean }> = [];

for (const entry of manifest) {
  const meta = await sharp(resolve(FIX, entry.file)).metadata();
  const buf = await sharp(resolve(FIX, entry.file)).grayscale()
    .resize({ width: meta.width! * SCALE, kernel: "lanczos3" }).normalize().sharpen().png().toBuffer();

  const t0 = Date.now();
  // PSM 6과 11을 함께 돌려 줄을 합친다. 6은 한글 라벨, 11은 라틴 접두사에 강하다.
  const all: OcrLine[] = [];
  for (const psm of ["6", "11"]) {
    await worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: "" });
    all.push(...lines((await worker.recognize(buf, {}, { blocks: true })).data, SCALE));
  }
  const ms = Date.now() - t0;

  const rows = extractRowsFromLines(all, { reviewThreshold: DEFAULT_REVIEW_THRESHOLD });
  const date = findMeasuredDateInLines(all);

  const total = Object.keys(entry.truth).length;
  let correct = 0, autoWrong = 0;
  console.log(`\n=== ${entry.title} (${entry.file}, ${meta.width}x${meta.height}) ===`);
  console.log(`검진일 ${date ?? "미검출"} (정답 ${entry.measuredDate}) · 줄 ${all.length}개 · ${ms}ms`);
  console.log(`${"항목".padEnd(16)}${"추출".padStart(8)}${"정답".padStart(8)}${"신뢰도".padStart(7)}  판정`);
  console.log("-".repeat(58));
  for (const code of Object.keys(entry.truth)) {
    const r = rows.find((x) => x.itemCode === code);
    const truth = entry.truth[code];
    const hit = r?.value === truth;
    if (hit) correct++;
    if (r && !r.needsReview && !hit) autoWrong++;
    console.log(
      `${(findItem(code)?.label ?? code).padEnd(16)}${String(r?.value ?? "-").padStart(8)}${String(truth).padStart(8)}` +
      `${String(r?.confidence ?? "-").padStart(7)}  ${hit ? "O" : "X"} ${r ? (r.needsReview ? "확인필요" : "자동확정") : "라벨미탐지"}`);
  }
  const matched = rows.filter((r) => r.itemCode);
  const auto = matched.filter((r) => !r.needsReview).length;
  console.log("-".repeat(58));
  console.log(`정확 ${correct}/${total} · 자동확정 ${auto} · 확인필요 ${matched.length - auto} · 오답자동확정 ${autoWrong}`);
  summary.push({ title: entry.title, correct, total, auto, review: matched.length - auto, autoWrong, ms, date: date === entry.measuredDate });
}
await worker.terminate();

console.log(`\n${"=".repeat(72)}\n종합 (임계값 ${DEFAULT_REVIEW_THRESHOLD})`);
console.log(`${"문서".padEnd(18)}${"정확".padStart(8)}${"자동확정".padStart(9)}${"확인필요".padStart(9)}${"오답자동확정".padStart(13)}${"검진일".padStart(8)}${"소요".padStart(9)}`);
for (const s of summary)
  console.log(`${s.title.padEnd(18)}${`${s.correct}/${s.total}`.padStart(8)}${String(s.auto).padStart(9)}${String(s.review).padStart(9)}${String(s.autoWrong).padStart(13)}${(s.date?"O":"X").padStart(8)}${`${s.ms}ms`.padStart(9)}`);
const tw = summary.reduce((a, s) => a + s.autoWrong, 0);
const tc = summary.reduce((a, s) => a + s.correct, 0);
const ti = summary.reduce((a, s) => a + s.total, 0);
console.log(`${"합계".padEnd(18)}${`${tc}/${ti}`.padStart(8)}${"".padStart(18)}${String(tw).padStart(13)}`);
console.log(tw === 0 ? "\n오답이 자동확정된 건이 없습니다." : "\n오답이 자동확정됐습니다 — 임계값 재조정 필요.");
process.exitCode = tw === 0 ? 0 : 1;
