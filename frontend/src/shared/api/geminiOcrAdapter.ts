export interface GeminiOcrResult {
  text: string;
  tables: Array<{ table_index: number; rows: string[][] }>;
  status: "raw";
  automatically_confirmed: false;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message: string;
}

/** 개발용 Gemini OCR 브리지. 원본·결과는 서버 DB에 저장하지 않는다. */
export class GeminiOcrAdapter {
  constructor(private readonly baseUrl = "http://127.0.0.1:8000/api/v1") {}

  async recognize(file: Blob, fileName: string): Promise<GeminiOcrResult> {
    const body = new FormData();
    body.append("file", file, fileName);
    const response = await fetch(`${this.baseUrl}/dev/ocr/recognize`, {
      method: "POST",
      body,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(error?.message ?? "건강자료 내용을 불러오지 못했어요.");
    }
    const envelope = await response.json() as ApiEnvelope<GeminiOcrResult>;
    return envelope.data;
  }
}
