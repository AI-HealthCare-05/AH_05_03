export interface RawOcrTable { table_index: number; rows: string[][] }
export interface RawOcrResult {
  text: string;
  tables: RawOcrTable[];
  status: "raw";
  automatically_confirmed: false;
}

export interface OcrAdapter {
  recognize(files: File | File[]): Promise<RawOcrResult>;
}

interface ApiEnvelope<T> { success: boolean; data: T; message: string }

export class DevServerOcrAdapter implements OcrAdapter {
  constructor(private readonly baseUrl = (import.meta.env.VITE_API_URL || "") + "/api/v1") {}

  async recognize(input: File | File[]): Promise<RawOcrResult> {
    const fileList = Array.isArray(input) ? input : [input];
    if (fileList.length === 0) {
      throw new Error("인식할 파일이 선택되지 않았습니다.");
    }
    const body = new FormData();
    for (const file of fileList) {
      body.append("files", file);
    }
    const response = await fetch(`${this.baseUrl}/dev/ocr/recognize`, { method: "POST", body });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { message?: string } | null;
      if (response.status === 413) throw new Error("파일 용량이 너무 큽니다. 20MB 이하의 서류를 선택해 주세요.");
      throw new Error(error?.message ?? "서류를 분석하지 못했습니다.");
    }
    const envelope = await response.json() as ApiEnvelope<RawOcrResult>;
    return envelope.data;
  }
}
