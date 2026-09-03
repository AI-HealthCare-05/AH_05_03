/**
 * 검진표 OCR 회귀 테스트용 합성 픽스처 생성기.
 *
 * 실제 검진 결과지는 개인정보라 리포지토리에 둘 수 없고, 언론사·상업 양식
 * 사이트 이미지는 저작권이 걸린다. 국민건강보험공단 결과통보서의 표준 레이아웃을
 * 참고해 가짜 수치로 직접 그린다. 정답을 우리가 아니까 자동 채점이 된다.
 *
 * 3종의 촬영 조건을 흉내낸다.
 *   A 디지털 원본  — 상한선. 이보다 잘 나올 수는 없다
 *   B 스캔본      — 노이즈 · 미세 회전 · 블러 · JPEG 열화
 *   C 휴대폰 촬영본 — 조명 불균일 · 낮은 대비 · 형광펜 · 회전
 *
 * 실행: npx tsx scripts/make-fixtures.ts
 */

import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../fixtures");

interface Row { code: string; label: string; value: string; unit: string; ref: string; verdict: string }

interface Fixture {
  id: string;
  title: string;
  measuredDate: string;
  rows: Row[];
  /** 형광펜을 칠할 행 인덱스 */
  highlight?: number;
}

const UNIT = "mg/dL";

const FIXTURES: Fixture[] = [
  {
    id: "checkup-a",
    title: "A 디지털 원본",
    measuredDate: "2026-03-11",
    rows: [
      { code: "total_cholesterol", label: "총콜레스테롤",   value: "185",  unit: UNIT, ref: "0~200",    verdict: "정상" },
      { code: "hdl_cholesterol",   label: "HDL-콜레스테롤", value: "62",   unit: UNIT, ref: "60 이상",  verdict: "정상" },
      { code: "ldl_cholesterol",   label: "LDL-콜레스테롤", value: "103",  unit: UNIT, ref: "0~130",    verdict: "정상" },
      { code: "triglyceride",      label: "트리글리세라이드", value: "98",   unit: UNIT, ref: "0~150",    verdict: "정상" },
      { code: "fasting_glucose",   label: "공복혈당",       value: "92",   unit: UNIT, ref: "70~100",   verdict: "정상" },
      { code: "hemoglobin",        label: "혈색소",         value: "14.2", unit: "g/dL", ref: "13~16.5", verdict: "정상" },
      { code: "bun",               label: "요소질소",       value: "15.0", unit: UNIT, ref: "8~20",     verdict: "정상" },
      { code: "creatinine",        label: "혈청크레아티닌",  value: "0.91", unit: UNIT, ref: "0~1.5",    verdict: "정상" },
      { code: "uric_acid",         label: "요산",           value: "5.4",  unit: UNIT, ref: "2.6~7.2",  verdict: "정상" },
    ],
  },
  {
    id: "checkup-b",
    title: "B 스캔본",
    measuredDate: "2025-11-04",
    rows: [
      { code: "total_cholesterol", label: "총콜레스테롤",   value: "236",  unit: UNIT, ref: "0~200",    verdict: "이상" },
      { code: "hdl_cholesterol",   label: "HDL-콜레스테롤", value: "38",   unit: UNIT, ref: "60 이상",  verdict: "이상" },
      { code: "ldl_cholesterol",   label: "LDL-콜레스테롤", value: "158",  unit: UNIT, ref: "0~130",    verdict: "이상" },
      { code: "triglyceride",      label: "트리글리세라이드", value: "214",  unit: UNIT, ref: "0~150",    verdict: "이상" },
      { code: "fasting_glucose",   label: "공복혈당",       value: "118",  unit: UNIT, ref: "70~100",   verdict: "이상" },
      { code: "hemoglobin",        label: "혈색소",         value: "13.1", unit: "g/dL", ref: "13~16.5", verdict: "정상" },
      { code: "bun",               label: "요소질소",       value: "18.4", unit: UNIT, ref: "8~20",     verdict: "정상" },
      { code: "creatinine",        label: "혈청크레아티닌",  value: "1.24", unit: UNIT, ref: "0~1.5",    verdict: "정상" },
      { code: "uric_acid",         label: "요산",           value: "7.8",  unit: UNIT, ref: "2.6~7.2",  verdict: "이상" },
    ],
  },
  {
    id: "checkup-c",
    title: "C 휴대폰 촬영본",
    measuredDate: "2026-01-27",
    rows: [
      { code: "total_cholesterol", label: "총콜레스테롤",   value: "201",  unit: UNIT, ref: "0~200",    verdict: "이상" },
      { code: "hdl_cholesterol",   label: "HDL-콜레스테롤", value: "55",   unit: UNIT, ref: "60 이상",  verdict: "이상" },
      { code: "ldl_cholesterol",   label: "LDL-콜레스테롤", value: "124",  unit: UNIT, ref: "0~130",    verdict: "정상" },
      { code: "triglyceride",      label: "트리글리세라이드", value: "142",  unit: UNIT, ref: "0~150",    verdict: "정상" },
      { code: "fasting_glucose",   label: "공복혈당",       value: "105",  unit: UNIT, ref: "70~100",   verdict: "이상" },
      { code: "hemoglobin",        label: "혈색소",         value: "15.0", unit: "g/dL", ref: "13~16.5", verdict: "정상" },
      { code: "bun",               label: "요소질소",       value: "12.7", unit: UNIT, ref: "8~20",     verdict: "정상" },
      { code: "creatinine",        label: "혈청크레아티닌",  value: "0.78", unit: UNIT, ref: "0~1.5",    verdict: "정상" },
      { code: "uric_acid",         label: "요산",           value: "6.2",  unit: UNIT, ref: "2.6~7.2",  verdict: "정상" },
    ],
    highlight: 2, // LDL 행에 형광펜
  },
];

// ── 레이아웃 (원본 픽셀) ────────────────────────────────
const W = 2100;
const H = 1500;
const X = { label: 260, value: 1180, unit: 1330, verdict: 1520, ref: 1760 };
const TABLE_TOP = 470;
const ROW_H = 92;
const FONT = "Malgun Gothic, 맑은 고딕, sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSvg(f: Fixture): string {
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);

  // 제목
  parts.push(`<text x="${W / 2}" y="130" font-family="${FONT}" font-size="58" font-weight="bold" text-anchor="middle" fill="#111">건강검진 결과통보서</text>`);
  parts.push(`<line x1="700" y1="152" x2="1400" y2="152" stroke="#111" stroke-width="3"/>`);

  // 머리말 — 개인 식별정보는 넣지 않는다
  parts.push(`<text x="${X.label}" y="240" font-family="${FONT}" font-size="34" fill="#222">성      명    (미표기)</text>`);
  parts.push(`<text x="1180" y="240" font-family="${FONT}" font-size="34" fill="#222">검 진 일    ${f.measuredDate}</text>`);
  parts.push(`<text x="${X.label}" y="300" font-family="${FONT}" font-size="34" fill="#222">검진기관    합성표본의원</text>`);
  parts.push(`<text x="1180" y="300" font-family="${FONT}" font-size="34" fill="#222">문서구분    테스트용 합성 문서</text>`);

  // 표 머리
  const headY = TABLE_TOP - 26;
  parts.push(`<rect x="200" y="${TABLE_TOP - 74}" width="${W - 400}" height="64" fill="#f0f0f0"/>`);
  parts.push(`<text x="${X.label}" y="${headY}" font-family="${FONT}" font-size="34" font-weight="bold" fill="#111">검사항목</text>`);
  parts.push(`<text x="${X.value}" y="${headY}" font-family="${FONT}" font-size="34" font-weight="bold" fill="#111" text-anchor="end">결과</text>`);
  parts.push(`<text x="${X.unit}" y="${headY}" font-family="${FONT}" font-size="34" font-weight="bold" fill="#111">단위</text>`);
  parts.push(`<text x="${X.verdict}" y="${headY}" font-family="${FONT}" font-size="34" font-weight="bold" fill="#111">판정</text>`);
  parts.push(`<text x="${X.ref}" y="${headY}" font-family="${FONT}" font-size="34" font-weight="bold" fill="#111">참고치</text>`);

  f.rows.forEach((r, i) => {
    const y = TABLE_TOP + ROW_H * i + 58;
    if (f.highlight === i) {
      // 노란 형광펜 — 적색 채널 전처리가 이걸 걷어내는지 본다
      parts.push(`<rect x="${X.label - 14}" y="${y - 46}" width="1050" height="62" fill="#fff34d" opacity="0.85"/>`);
    }
    parts.push(`<text x="${X.label}" y="${y}" font-family="${FONT}" font-size="38" fill="#111">${esc(r.label)}</text>`);
    parts.push(`<text x="${X.value}" y="${y}" font-family="${FONT}" font-size="38" fill="#111" text-anchor="end">${esc(r.value)}</text>`);
    parts.push(`<text x="${X.unit}" y="${y}" font-family="${FONT}" font-size="30" fill="#555">${esc(r.unit)}</text>`);
    parts.push(`<text x="${X.verdict}" y="${y}" font-family="${FONT}" font-size="34" fill="#111">${esc(r.verdict)}</text>`);
    parts.push(`<text x="${X.ref}" y="${y}" font-family="${FONT}" font-size="32" fill="#333">${esc(r.ref)}</text>`);
    parts.push(`<line x1="200" y1="${y + 24}" x2="${W - 200}" y2="${y + 24}" stroke="#d8d8d8" stroke-width="2"/>`);
  });

  // 표 테두리
  const tableH = ROW_H * f.rows.length + 74;
  parts.push(`<rect x="200" y="${TABLE_TOP - 74}" width="${W - 400}" height="${tableH}" fill="none" stroke="#333" stroke-width="3"/>`);
  parts.push(`<text x="${X.label}" y="${TABLE_TOP + tableH + 20}" font-family="${FONT}" font-size="30" fill="#555">※ 본 문서는 OCR 회귀 테스트용으로 생성한 가짜 데이터입니다.</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join("")}</svg>`;
}

/** 촬영 조건 흉내 */
async function degrade(png: Buffer, id: string): Promise<Buffer> {
  if (id === "checkup-a") return sharp(png).png().toBuffer();

  if (id === "checkup-b") {
    // 스캔본: 미세 회전 → 블러 → 노이즈 → JPEG 열화
    const rotated = await sharp(png).rotate(0.7, { background: "#ffffff" }).blur(0.6).toBuffer();
    const { width, height } = await sharp(rotated).metadata();
    const noise = Buffer.alloc(width! * height!);
    // 결정적 노이즈 — 시드 고정이라 매 실행 같은 이미지가 나온다
    let seed = 12345;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = 118 + ((seed >> 16) % 20);
    }
    return sharp(rotated)
      .composite([{ input: noise, raw: { width: width!, height: height!, channels: 1 }, blend: "overlay" }])
      .jpeg({ quality: 62 })
      .toBuffer();
  }

  // 휴대폰 촬영본: 조명 불균일 + 대비 저하 + 회전
  const { width, height } = await sharp(png).metadata();
  const light = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.02"/>
        <stop offset="55%" stop-color="#000000" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.30"/>
      </linearGradient></defs>
      <rect width="${width}" height="${height}" fill="url(#g)"/>
    </svg>`,
  );
  return sharp(png)
    .composite([{ input: light, blend: "over" }])
    .rotate(-1.4, { background: "#e8e8e8" })
    .linear(0.86, 18) // 대비 낮추고 전체를 살짝 밝게
    .jpeg({ quality: 70 })
    .toBuffer();
}

mkdirSync(OUT, { recursive: true });
const manifest: Array<{ id: string; title: string; file: string; measuredDate: string; truth: Record<string, number> }> = [];

for (const f of FIXTURES) {
  const base = await sharp(Buffer.from(buildSvg(f))).png().toBuffer();
  const final = await degrade(base, f.id);
  const ext = f.id === "checkup-a" ? "png" : "jpg";
  const file = `${f.id}.${ext}`;
  writeFileSync(resolve(OUT, file), final);

  const truth: Record<string, number> = {};
  for (const r of f.rows) truth[r.code] = Number(r.value);
  manifest.push({ id: f.id, title: f.title, file, measuredDate: f.measuredDate, truth });

  const meta = await sharp(final).metadata();
  console.log(`${f.id.padEnd(12)} ${f.title.padEnd(14)} ${meta.width}x${meta.height}  ${(final.length / 1024).toFixed(0)}KB  항목 ${f.rows.length}개`);
}

writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\n${OUT}\nmanifest.json 저장 완료`);
