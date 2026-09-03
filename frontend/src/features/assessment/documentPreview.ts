/**
 * 올린 검진표를 판정 폼 옆에 띄우기 위한 페이지 이미지.
 *
 * 왜 PDF 도 이미지로 바꾸는가
 * ---------------------------
 * `<embed>`·`<object>` 로 PDF 를 띄우는 길은 막혀 있다 — 서빙 CSP 가 `object-src 'none'`
 * 이고, 그건 판정 화면 하나 때문에 풀 만한 값이 아니다. 대신 `pdfjs-dist` 로 캔버스에
 * 그려 PNG 로 뽑는다.
 *
 * 왜 `blob:` 인가
 * ---------------
 * 원본은 암호화되어 OPFS 에 있다. 주소가 없으므로 복호화한 `Blob` 을 그대로 건다.
 * 이 때문에 서빙 CSP 의 `img-src` 에 `blob:` 을 더했다(`app/apis/spa.py`).
 *
 * **부른 쪽이 반드시 `release()` 를 불러야 한다.** `createObjectURL` 은 문서가 살아
 * 있는 동안 원본 바이트를 메모리에 붙잡아 둔다 — 검진표 여러 장을 잇달아 열면
 * 그만큼 쌓인다.
 */

export interface DocumentPreview {
  /** 페이지별 `blob:` 주소. 이미지는 한 장, PDF 는 쪽수만큼. */
  pages: string[];
  release(): void;
}

const EMPTY: DocumentPreview = { pages: [], release: () => {} };

export async function buildPreview(file: Blob, mimeType: string): Promise<DocumentPreview> {
  if (mimeType === "application/pdf") {
    return fromUrls(await renderPdf(file));
  }
  if (mimeType.startsWith("image/")) {
    return fromUrls([URL.createObjectURL(file)]);
  }
  return EMPTY;
}

function fromUrls(pages: string[]): DocumentPreview {
  return {
    pages,
    release: () => pages.forEach((url) => URL.revokeObjectURL(url)),
  };
}

/**
 * 쪽수 상한을 둔다. 검진표는 보통 한두 장인데, 사용자가 잘못 고른 수백 쪽짜리
 * 문서를 만나면 캔버스 렌더링이 브라우저를 통째로 멈춘다.
 */
const MAX_PAGES = 8;

async function renderPdf(file: Blob): Promise<string[]> {
  const [{ getDocument, GlobalWorkerOptions }, { default: workerUrl }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = workerUrl;
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), useWasm: true });
  const pdf = await task.promise;
  const urls: string[] = [];
  try {
    const pageCount = Math.min(pdf.numPages, MAX_PAGES);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      // 확대해서 숫자를 대조하는 화면이라 등배로 뽑으면 글자가 뭉갠다.
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("PDF 페이지를 그릴 수 없습니다.");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      urls.push(URL.createObjectURL(await canvasBlob(canvas)));
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return urls;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PDF 페이지 이미지 변환에 실패했습니다."))),
      "image/png",
    );
  });
}
