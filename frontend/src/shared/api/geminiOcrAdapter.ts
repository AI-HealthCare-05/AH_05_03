/**
 * 문서 인식 어댑터 — 큐에 싣고 결과를 폴링한다.
 *
 *     nginx → FastAPI → Redis(큐) → ai-worker → Gemini
 *
 * 동기 호출을 쓰지 않는 이유는 왕복 시간이다. Gemini 응답이 수십 초까지 걸려서 요청을
 * 매달아 두면 nginx 타임아웃과 사용자 대기가 함께 늘어난다. 서버가 202 로 `job_id` 를
 * 주고 워커가 처리한 결과를 이쪽이 받아 간다.
 *
 * 실제 호출은 `serverApiClient` 가 한다 — 상대 경로·인증 헤더·토큰 갱신·오류 봉투를
 * 공짜로 얻는다.
 */

import { ServerApiError, serverApiClient } from "./serverApiClient";

/** 표에서 읽어 낸 행 하나. `source` 는 원문 4열이라 화면이 원본과 대조할 수 있다. */
export interface OcrMeasurementRow {
  field: string;
  label: string;
  value: number;
  unit: string;
  source: string[];
  reason: string | null;
}

/**
 * 표를 예측 입력 수치로 옮긴 결과. 판정 규칙은 서버(`app/services/ocr_measurements.py`)에 있다.
 *
 * **`values` 만 판정 폼으로 넘긴다.** `review` 는 단위·참고치·범위 관문에 걸린 행이라
 * 사람이 눈으로 확인하기 전에는 수치로 취급하지 않는다 — 검사명 오독이 그대로 수치가
 * 되면 사용자는 자기가 적지도 않은 숫자로 판정받는다.
 */
export interface OcrMeasurements {
  values: Record<string, number>;
  review: OcrMeasurementRow[];
  unused: OcrMeasurementRow[];
  unmatched: string[][];
}

export interface GeminiOcrResult {
  text: string;
  tables: Array<{ table_index: number; rows: string[][] }>;
  status: "raw";
  automatically_confirmed: false;
  measurements?: OcrMeasurements | null;
}

interface JobAccepted {
  job_id: string;
  status: string;
  poll_after_ms: number;
}

interface JobStatus {
  job_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  error: string | null;
  result: GeminiOcrResult | null;
}

/** 폴링 상한. 워커가 죽어 영영 안 끝나는 작업에 매달리지 않는다. */
const MAX_WAIT_MS = 180_000;
const MIN_INTERVAL_MS = 800;

/** 네트워크 순단이나 5xx 한 번으로 이미 성공한 OCR 작업을 버리지 않는다. */
function isTransientReadFailure(error: unknown): boolean {
  if (error instanceof ServerApiError) return error.status >= 500 || error.status === 429;
  // fetch 자체가 응답을 못 받은 경우(TypeError 등)도 다음 폴링에서 복구할 수 있다.
  return error instanceof TypeError;
}

/** 인식 중 화면에 보여 줄 진행 상황. */
export interface OcrProgress {
  /** 지금까지 인식된 글. 이어 붙인 결과다. */
  text: string;
}

export interface RecognizeOptions {
  /**
   * 진행 상황 콜백. 주면 SSE 로 붙어 글자가 들어오는 대로 부른다.
   * **주지 않으면 예전처럼 폴링만 한다** — 기존 호출부는 고칠 것이 없다.
   */
  onProgress?: (progress: OcrProgress) => void;
  signal?: AbortSignal;
}

export class GeminiOcrAdapter {
  async recognize(file: Blob, fileName: string, options: RecognizeOptions = {}): Promise<GeminiOcrResult> {
    const accepted = await serverApiClient.enqueueDocumentJob<JobAccepted>(file, fileName);

    if (options.onProgress) {
      const streamed = await this.stream(accepted.job_id, options);
      // **스트리밍이 실패해도 폴링으로 떨어진다.** SSE 는 중간 프록시·확장 프로그램·
      // 사내 방화벽이 끊는 일이 흔하고, 그때 인식 자체는 서버에서 멀쩡히 끝나 있다.
      // 진행 표시를 못 보여 준 것과 결과를 못 준 것은 무게가 다르다.
      if (streamed) return streamed;
    }


    // 서버가 알려 준 대기 시간을 존중하되 하한을 둔다. 0 을 받으면 폭주한다.
    const interval = Math.max(MIN_INTERVAL_MS, accepted.poll_after_ms || 0);
    const deadline = Date.now() + MAX_WAIT_MS;

    for (;;) {
      let job: JobStatus;
      try {
        job = await serverApiClient.readDocumentJob<JobStatus>(accepted.job_id);
      } catch (error) {
        if (!isTransientReadFailure(error)) throw error;
        if (Date.now() > deadline) {
          throw new Error("문서 인식이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요.");
        }
        // 작업은 서버에서 계속 돈다. 같은 job_id를 다시 조회해야 하며 새 작업을
        // 등록하면 Gemini 비용과 개인정보 원본 체류 시간만 늘어난다.
        await new Promise((resolve) => setTimeout(resolve, interval));
        continue;
      }
      if (job.status === "succeeded" && job.result) return job.result;
      if (job.status === "failed") throw new Error(messageFor(job.error ?? ""));
      if (Date.now() > deadline) {
        throw new Error("문서 인식이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요.");
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  /**
   * SSE 로 진행 상황을 받는다. 끝나면 결과, 스트림이 못 붙으면 `null`.
   *
   * `null` 이면 호출부가 폴링으로 이어 간다 — 인식은 워커에서 이미 돌고 있으므로
   * 작업을 다시 등록하지 않고 같은 `job_id` 를 폴링하면 된다.
   */
  private async stream(jobId: string, options: RecognizeOptions): Promise<GeminiOcrResult | null> {
    const onProgress = options.onProgress;
    let text = "";
    let result: GeminiOcrResult | null = null;
    let failure: string | null = null;

    try {
      await serverApiClient.streamDocumentJob(
        jobId,
        (event, data) => {
          if (event === "delta") {
            text += String(data.text ?? "");
            onProgress?.({ text });
          } else if (event === "reset") {
            // 앞 모델이 도중에 죽어 다른 모델로 다시 시작했다. 지우지 않으면
            // 앞뒤가 섞인 글이 된다.
            text = "";
            onProgress?.({ text });
          } else if (event === "done") {
            result = (data.result as GeminiOcrResult | null) ?? null;
          } else if (event === "error") {
            failure = String(data.error ?? "RECOGNITION_FAILED");
          }
        },
        options.signal,
      );
    } catch {
      return null; // 폴링으로 떨어진다
    }

    if (failure) throw new Error(messageFor(failure));
    return result;
  }
}

// 서버가 원인별로 코드를 나눠 주므로 여기서도 나눠 안내한다.
//
// **예전에는 전부 한 문장이었다.** `OCR_UNAVAILABLE` 하나가 "파일 없음·형식·용량·
// 브리지 꺼짐·외부 API 실패" 를 다 뜻해서 25MB 사진을 올린 사람도 ".docx" 를 올린
// 사람도 똑같이 "설정을 확인해 주세요" 를 봤다. 서버는 "각 20MB 이하여야 합니다" 라고
// 정확히 알려 주는데 그 문장이 여기서 버려졌다.
//
// 사용자가 고칠 수 있는 것(파일 바꾸기·줄이기)과 기다려야 하는 것(공급자 장애)과
// 우리가 고쳐야 하는 것(브리지 꺼짐)을 다르게 말해 준다.
const OCR_MESSAGES: Record<string, string> = {
  OCR_NO_FILE: "인식할 파일을 첨부해 주세요.",
  OCR_UNSUPPORTED_TYPE: "JPEG, PNG, WEBP 이미지 또는 PDF 문서만 인식할 수 있어요.",
  OCR_FILE_TOO_LARGE: "파일이 너무 큽니다. 크기를 줄이거나 여러 장으로 나눠 올려 주세요.",
  OCR_JOB_NOT_FOUND: "인식 결과가 만료됐어요. 다시 올려 주세요.",
  OCR_PROVIDER_FAILED: "문서 인식이 실패했어요. 잠시 후 다시 시도해 주세요.",
  OCR_UNAVAILABLE: "문서 인식 기능을 잠시 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  SERVICE_UNAVAILABLE: "문서 인식 서버 연결이 잠시 불안정합니다. 잠시 후 다시 시도해 주세요.",
  TIMEOUT: "문서 인식이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요.",
  EXPIRED: "문서 인식이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요.",
};

function messageFor(code: string): string {
  return OCR_MESSAGES[code] ?? "건강자료 내용을 불러오지 못했어요.";
}
