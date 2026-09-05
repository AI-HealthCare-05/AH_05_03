import { afterEach, describe, expect, it, vi } from "vitest";

import { GeminiOcrAdapter, type GeminiOcrResult } from "./geminiOcrAdapter";
import { ServerApiError, serverApiClient } from "./serverApiClient";

const RESULT: GeminiOcrResult = {
  text: "검사 결과",
  tables: [{ table_index: 0, rows: [["항목", "결과"], ["혈당", "92"]] }],
  status: "raw",
  automatically_confirmed: false,
};

describe("GeminiOcrAdapter", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("결과 폴링이 일시적으로 끊겨도 같은 작업을 다시 조회한다", async () => {
    vi.useFakeTimers();
    vi.spyOn(serverApiClient, "enqueueDocumentJob").mockResolvedValue({
      job_id: "job-one",
      status: "queued",
      poll_after_ms: 1,
    });
    const read = vi
      .spyOn(serverApiClient, "readDocumentJob")
      .mockRejectedValueOnce(new TypeError("network disconnected"))
      .mockRejectedValueOnce(new ServerApiError(502, "INTERNAL_ERROR", "temporary"))
      .mockResolvedValueOnce({
        job_id: "job-one",
        status: "succeeded",
        attempts: 1,
        error: null,
        result: RESULT,
      });

    const promise = new GeminiOcrAdapter().recognize(new Blob(["image"]), "result.jpeg");
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual(RESULT);
    expect(read).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenNthCalledWith(1, "job-one");
    expect(read).toHaveBeenNthCalledWith(3, "job-one");
  });

  it("404처럼 재시도로 회복되지 않는 오류는 즉시 전달한다", async () => {
    vi.spyOn(serverApiClient, "enqueueDocumentJob").mockResolvedValue({
      job_id: "expired-job",
      status: "queued",
      poll_after_ms: 1,
    });
    vi.spyOn(serverApiClient, "readDocumentJob").mockRejectedValue(
      new ServerApiError(404, "OCR_JOB_NOT_FOUND", "expired"),
    );

    await expect(new GeminiOcrAdapter().recognize(new Blob(["image"]), "result.jpeg")).rejects.toMatchObject({
      status: 404,
      errorCode: "OCR_JOB_NOT_FOUND",
    });
  });
});
