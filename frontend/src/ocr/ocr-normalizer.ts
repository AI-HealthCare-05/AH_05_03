import type { OcrContent, OcrExamItem } from "../local-domain/types";
import type { RawOcrResult } from "./ocr-adapter";

export const normalizeLineBreaks = (value: string) => value.replace(/\\r\\n|\\n|\\r/g, "\n").replace(/\r\n?/g, "\n");

const cellsFrom = (values: string[]) => values
  .flatMap((value) => normalizeLineBreaks(value).split(/\n|\|/))
  .map((value) => value.trim())
  .filter(Boolean);

function toExamItem(cells: string[]): OcrExamItem | null {
  if (cells.length < 2) return null;
  const [testName = "", value = "", unit = "", ...judgment] = cells;
  if (!testName || /^검사\s*항목$/i.test(testName)) return null;
  return { testName, value, unit, judgment: judgment.join(" ") };
}

export function normalizeOcrResult(raw: RawOcrResult): OcrContent {
  const text = normalizeLineBreaks(raw.text);
  const tables = raw.tables.map((table) => ({
    ...table,
    rows: table.rows.map((row) => row.map(normalizeLineBreaks)),
  }));
  const tableItems = tables.flatMap((table) => table.rows.map((row) => toExamItem(cellsFrom(row)))).filter((item): item is OcrExamItem => Boolean(item));
  const textItems = text.split("\n").map((line) => toExamItem(cellsFrom([line]))).filter((item): item is OcrExamItem => Boolean(item));
  const examItems = tableItems.length ? tableItems : textItems;

  let examDate = raw.exam_date || null;
  if (!examDate) {
    // 2024.05.12, 2024년 5월 12일, 2024-05-12 등 텍스트에서 검사일자 정규식 검색
    const match = text.match(/(?:검사|검진|시행|발행|판정|접수)?\s*(?:일자|일시|일)?\s*[:：]?\s*(\d{4})[년.\-/]\s*(\d{1,2})[월.\-/]\s*(\d{1,2})[일]?/);
    if (match) {
      const y = match[1];
      const m = match[2].padStart(2, "0");
      const d = match[3].padStart(2, "0");
      examDate = `${y}-${m}-${d}`;
    }
  }

  return { text, tables, examItems, examDate };
}
