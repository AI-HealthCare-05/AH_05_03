/**
 * 검진표 항목명 인식 벤치마크.
 *
 * 값 추출과 별개로, 사전 매칭이 실제 양식에서 얼마나 붙는지를 잰다.
 * 값이 비어 있는 양식(빈 템플릿·모자이크 처리본)으로도 측정할 수 있어서
 * 개인정보가 없는 문서로 회귀 검증이 가능하다.
 *
 * 실행: npx tsx scripts/bench-labels.ts <이미지경로> [설명]
 */

import { createWorker } from "tesseract.js";
import sharp from "sharp";
import type { OcrWord } from "../local-domain/ocr/types";
import { mergeLines } from "../local-domain/ocr/table-extractor";
import { CHECKUP_ITEMS, matchLabel, normalize } from "../local-domain/ocr/checkup-lexicon";

const path = process.argv[2];
const title = process.argv[3] ?? path;
if (!path) {
  console.error("사용법: npx tsx scripts/bench-labels.ts <이미지경로> [설명]");
  process.exit(2);
}

const SCALE = 3;

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

const meta = await sharp(path).metadata();
const buf = await sharp(path)
  .grayscale()
  .resize({ width: (meta.width ?? 800) * SCALE, kernel: "lanczos3" })
  .normalize()
  .sharpen()
  .png()
  .toBuffer();

const worker = await createWorker("kor+eng", 1);
await worker.setParameters({ tessedit_pageseg_mode: "4", tessedit_char_whitelist: "" });
const t0 = Date.now();
const { data } = await worker.recognize(buf, {}, { text: true, blocks: true });
const elapsed = Date.now() - t0;
await worker.terminate();

const words = flatten(data);
const lines = words.map((w) => ({ y: w.y, text: w.text, confidence: w.confidence }));

// 1) 사전 항목이 인식 텍스트 안에 원형으로 존재하는가 (정규화 후 부분일치)
const flatText = normalize((data.text ?? "") as string);
const literal = CHECKUP_ITEMS.filter((i) => i.aliases.some((a) => flatText.includes(normalize(a))));

// 2) 퍼지 매칭으로 붙는가 (실제 파이프라인이 쓰는 경로)
const fuzzy = new Map<string, { raw: string; sim: number; conf: number }>();
for (const l of lines) {
  const m = matchLabel(l.text);
  if (!m) continue;
  const prev = fuzzy.get(m.item.code);
  if (!prev || m.similarity > prev.sim) fuzzy.set(m.item.code, { raw: l.text, sim: m.similarity, conf: l.confidence });
}

console.log(`\n=== ${title} ===`);
console.log(`${meta.width}x${meta.height} · ${elapsed}ms · 줄 ${lines.length}개 · 단어 ${words.length}개`);
console.log(`사전 ${CHECKUP_ITEMS.length}개 중 — 원형 일치 ${literal.length}개 · 퍼지 매칭 ${fuzzy.size}개\n`);

console.log(`${"항목".padEnd(18)}${"원형".padEnd(6)}${"퍼지".padEnd(6)}${"유사도".padStart(7)}${"신뢰도".padStart(7)}  인식 원문`);
console.log("-".repeat(78));
for (const item of CHECKUP_ITEMS) {
  const lit = literal.includes(item) ? "O" : "-";
  const f = fuzzy.get(item.code);
  console.log(
    `${item.label.padEnd(18)}${lit.padEnd(6)}${(f ? "O" : "-").padEnd(6)}` +
    `${(f ? `${(f.sim * 100).toFixed(0)}%` : "-").padStart(7)}${(f ? f.conf.toFixed(0) : "-").padStart(7)}  ${f ? f.raw.slice(0, 24) : ""}`,
  );
}
console.log("-".repeat(78));
