/**
 * Tesseract.js 엔진 어댑터 (브라우저).
 *
 * 엔진은 교체 대상이다. docs/10_local_data_contract.md §3.3의 OcrResult가
 * engine·engineVersion을 따로 보관하는 이유가 이것이다. 정확도가 부족하면
 * 같은 OcrEngine 인터페이스로 ONNX Runtime Web + PaddleOCR 어댑터를 붙인다.
 *
 * 네트워크: traineddata를 최초 1회 내려받은 뒤 캐시한다. 인식 자체는
 * WASM으로 기기 안에서 끝나며 이미지가 외부로 나가지 않는다 (ADR-002 §5).
 */

import type { ImageSource, OcrEngine, OcrWord, RecognizeHint, Rect } from "./types";

// tesseract.js는 런타임에만 필요하다. 타입은 최소한만 선언해 의존을 줄인다.
interface TesseractWorker {
  setParameters(p: Record<string, unknown>): Promise<unknown>;
  recognize(image: unknown, opts?: unknown, output?: unknown): Promise<{ data: TesseractData }>;
  terminate(): Promise<unknown>;
}
interface TesseractData {
  blocks?: Array<{
    paragraphs?: Array<{
      lines?: Array<{
        words?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
      }>;
    }>;
  }>;
}

/** 전처리 배율. 3배가 정확도와 속도의 타협점이었다 */
const SCALE = 3;

/** PSM: 6=단일 블록. 표 한 열처럼 균일한 덩어리에 적합 */
const PSM_SINGLE_BLOCK = "6";

export interface TesseractEngineOptions {
  /** createWorker를 주입한다. 테스트에서 가짜 엔진으로 바꿔 끼울 수 있다 */
  createWorker: (langs: string, oem?: number, opts?: unknown) => Promise<TesseractWorker>;
  langs?: string;
  version?: string;
}

export class TesseractOcrEngine implements OcrEngine {
  readonly id = "tesseract.js";
  readonly version: string;
  private readonly langs: string;
  private readonly createWorker: TesseractEngineOptions["createWorker"];
  private worker: TesseractWorker | null = null;

  constructor(opts: TesseractEngineOptions) {
    this.createWorker = opts.createWorker;
    this.langs = opts.langs ?? "kor+eng";
    this.version = opts.version ?? "7";
  }

  private async ensureWorker(): Promise<TesseractWorker> {
    if (!this.worker) this.worker = await this.createWorker(this.langs, 1);
    return this.worker;
  }

  async recognize(image: ImageSource, region: Rect, hint: RecognizeHint): Promise<OcrWord[]> {
    const worker = await this.ensureWorker();
    const canvas = await preprocess(image, region, hint);

    await worker.setParameters({
      tessedit_pageseg_mode: PSM_SINGLE_BLOCK,
      // 값 열은 숫자와 소수점만 허용한다. 이것만으로 6.1이 b.1로 읽히는 사고가 사라진다
      tessedit_char_whitelist: hint.charset === "numeric" ? "0123456789." : "",
    });

    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    return flatten(data);
  }

  async dispose(): Promise<void> {
    await this.worker?.terminate();
    this.worker = null;
  }
}

/** blocks → paragraphs → lines → words 를 평탄화하고 좌표를 원본 스케일로 되돌린다 */
export function flatten(data: TesseractData): OcrWord[] {
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
          });
        }
  return out;
}

/**
 * 영역을 잘라 확대하고, 필요하면 형광펜을 지운다.
 *
 * 노란 형광펜 위의 검은 글씨는 그레이스케일로 바꾸면 배경과 붙어버린다.
 * 노랑은 적색 성분이 높으므로 적색 채널만 남기면 형광펜이 거의 흰색이 되고
 * 글씨만 남는다. 실측에서 이 한 줄이 69를 63으로 읽던 오류를 없앴다.
 */
async function preprocess(image: ImageSource, region: Rect, hint: RecognizeHint): Promise<OffscreenCanvas> {
  const bitmap = await toBitmap(image);
  const canvas = new OffscreenCanvas(region.width * SCALE, region.height * SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    bitmap,
    region.left, region.top, region.width, region.height,
    0, 0, canvas.width, canvas.height,
  );

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // dropHighlight면 적색 채널만, 아니면 표준 휘도 가중치
    const v = hint.dropHighlight ? d[i] : 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  stretchContrast(d);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** 명암 정규화. sharp의 normalize()에 해당한다 */
function stretchContrast(d: Uint8ClampedArray): void {
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < lo) lo = d[i];
    if (d[i] > hi) hi = d[i];
  }
  const span = hi - lo;
  if (span < 1) return;
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - lo) * 255) / span;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}

async function toBitmap(image: ImageSource): Promise<ImageBitmap> {
  if (typeof image === "string") {
    const res = await fetch(image);
    return createImageBitmap(await res.blob());
  }
  if (image instanceof Blob) return createImageBitmap(image);
  return createImageBitmap(new Blob([image]));
}
