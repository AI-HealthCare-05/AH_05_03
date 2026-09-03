export interface OcrProgress {
  status: string;
  progress: number;
}

export class BrowserOcrAdapter {
  public async recognize(image: Blob, onProgress?: (progress: OcrProgress) => void): Promise<string> {
    const sources = image.type === "application/pdf"
      ? await renderPdfPages(image, onProgress)
      : image.type.startsWith("image/")
        ? [image]
        : [];
    if (sources.length === 0) throw new Error("이미지 또는 PDF 형식의 건강 서류만 읽을 수 있습니다.");
    const { createWorker, OEM } = await import("tesseract.js");
    const worker = await createWorker("kor+eng", OEM.LSTM_ONLY, {
      logger: (message) => onProgress?.({ status: message.status, progress: message.progress }),
    });
    try {
      const texts: string[] = [];
      for (let index = 0; index < sources.length; index += 1) {
        onProgress?.({ status: `${index + 1}/${sources.length}페이지 문자 인식`, progress: index / sources.length });
        const result = await worker.recognize(sources[index]);
        texts.push(result.data.text.trim());
      }
      return texts.filter(Boolean).join("\n\n");
    } finally {
      await worker.terminate();
    }
  }
}

async function renderPdfPages(
  file: Blob,
  onProgress?: (progress: OcrProgress) => void,
): Promise<Blob[]> {
  const [{ getDocument, GlobalWorkerOptions }, { default: pdfWorkerUrl }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useWasm: true,
  });
  const pdf = await task.promise;
  const pages: Blob[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.({ status: `${pageNumber}/${pdf.numPages}페이지 로컬 렌더링`, progress: pageNumber / pdf.numPages });
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("PDF 페이지를 그릴 수 없습니다.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    pages.push(await canvasBlob(canvas));
    page.cleanup();
  }
  await task.destroy();
  return pages;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PDF 페이지 이미지 변환에 실패했습니다.")), "image/png");
  });
}
