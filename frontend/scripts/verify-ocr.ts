/**
 * 검진표 OCR 파이프라인 검증 — 실제 결과지로 정확도를 잰다.
 *
 * 브라우저 어댑터(tesseract-engine.ts)는 OffscreenCanvas를 쓰므로 Node에서 못 돈다.
 * 여기서는 sharp로 같은 전처리(크롭 · 3배 확대 · 적색 채널 · 명암 정규화)를 재현하고,
 * 짝짓기·사전 매칭 같은 순수 코어는 프로덕션과 동일한 모듈을 그대로 쓴다.
 *
 * 실행: npm run verify:ocr
 */

import { createWorker } from "tesseract.js";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { OcrWord, Rect } from "../local-domain/ocr/types";
import { findMeasuredDate, pairRows, DEFAULT_REVIEW_THRESHOLD } from "../local-domain/ocr/table-extractor";
import { findItem } from "../local-domain/ocr/checkup-lexicon";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE = resolve(HERE, "../../sample.jpeg");
const SCALE = 3;

/** sample.jpeg(2123x3039)에서 실측한 열 위치 */
const REGIONS: Record<"label" | "value" | "date", Rect> = {
  date:  { left: 130,  top: 150, width: 400, height: 500 },
  label: { left: 600,  top: 150, width: 680, height: 500 },
  value: { left: 1250, top: 150, width: 210, height: 500 },
};

/** 사람이 눈으로 읽은 정답 */
const TRUTH: Record<string, number> = {
  hdl_cholesterol: 50,
  ldl_cholesterol: 167,
  triglyceride: 69,
  bun: 12.0,
  creatinine: 0.88,
  uric_acid: 6.1,
};

async function prep(region: Rect, dropHighlight: boolean): Promise<Buffer> {
  let p = sharp(SAMPLE).extract(region);
  p = dropHighlight ? p.extractChannel("red") : p.grayscale();
  return p.resize({ width: region.width * SCALE, kernel: "lanczos3" }).normalize().sharpen().png().toBuffer();
}

function flatten(data: any): OcrWord[] {
  const out: OcrWord[] = [];
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs ?? [])
      for (const l of p.lines ?? [])
        for (const w of l.words ?? []) {
          if (!w.text.trim()) continue;
          out.push({
            text: w.text.trim(),
            confidence: w.confidence,
            x: w.bbox.x0 / SCALE,
            y: (w.bbox.y0 + w.bbox.y1) / 2 / SCALE,
            width: (w.bbox.x1 - w.bbox.x0) / SCALE,
          });
        }
  return out;
}

const worker = await createWorker("kor+eng", 1);
const t0 = Date.now();

await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "" });
const labelWords = flatten((await worker.recognize(await prep(REGIONS.label, false), {}, { blocks: true })).data);
const dateWords = flatten((await worker.recognize(await prep(REGIONS.date, false), {}, { blocks: true })).data);

await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "0123456789." });
const valueWords = flatten((await worker.recognize(await prep(REGIONS.value, true), {}, { blocks: true })).data);

await worker.terminate();
const elapsed = Date.now() - t0;

// ── 여기부터는 프로덕션과 동일한 순수 코어 ──
const rows = pairRows(labelWords, valueWords);
const measuredDate = findMeasuredDate(dateWords);

console.log(`검진일: ${measuredDate ?? "미검출"}`);
console.log(`소요: ${elapsed}ms · 임계값: ${DEFAULT_REVIEW_THRESHOLD}\n`);

const head = ["항목", "값", "신뢰도", "판정", "정답", "일치"];
console.log(`${head[0].padEnd(18)}${head[1].padStart(8)}${head[2].padStart(8)}  ${head[3].padEnd(10)}${head[4].padStart(7)}  ${head[5]}`);
console.log("-".repeat(68));

let correct = 0;
let autoWrong = 0;
for (const r of rows) {
  const item = r.itemCode ? findItem(r.itemCode) : undefined;
  const truth = r.itemCode ? TRUTH[r.itemCode] : undefined;
  const hit = truth !== undefined && r.value === truth;
  if (hit) correct++;
  if (!r.needsReview && !hit) autoWrong++;
  const name = item?.label ?? `?(${r.rawLabel.slice(0, 10)})`;
  console.log(
    `${name.padEnd(18)}${String(r.value ?? "-").padStart(8)}${String(r.confidence).padStart(8)}  ` +
    `${(r.needsReview ? "확인필요" : "자동확정").padEnd(10)}${String(truth ?? "-").padStart(7)}  ${hit ? "O" : "X"}`,
  );
}

const total = Object.keys(TRUTH).length;
console.log("-".repeat(68));
console.log(`정확히 추출: ${correct}/${total}`);
console.log(`자동확정: ${rows.filter((r) => !r.needsReview).length}건 · 확인필요: ${rows.filter((r) => r.needsReview).length}건`);
console.log(`오답이 자동확정된 건수: ${autoWrong}  ${autoWrong === 0 ? "(임계값이 오인식을 전부 걸러냄)" : "(임계값 재조정 필요)"}`);

process.exitCode = autoWrong === 0 ? 0 : 1;
