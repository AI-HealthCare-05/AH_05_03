export interface RawOcrTable { table_index: number; rows: string[][] }
export interface RawOcrResult {
  text: string;
  tables: RawOcrTable[];
  status: "raw";
  automatically_confirmed: false;
}

export interface OcrAdapter {
  recognize(file: File): Promise<RawOcrResult>;
}

interface ApiEnvelope<T> { success: boolean; data: T; message: string }

export class DevServerOcrAdapter implements OcrAdapter {
  constructor(private readonly baseUrl = "http://127.0.0.1:8000/api/v1") {}

  async recognize(file: File): Promise<RawOcrResult> {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch(`${this.baseUrl}/dev/ocr/recognize`, { method: "POST", body });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(error?.message ?? "OCR 실행에 실패했습니다.");
    }
    const envelope = await response.json() as ApiEnvelope<RawOcrResult>;
    return envelope.data;
  }
}
