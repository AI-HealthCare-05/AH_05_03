import { afterEach, describe, expect, it, vi } from "vitest";

import { DevServerOcrAdapter } from "./ocr-adapter";

afterEach(() => vi.unstubAllGlobals());

describe("DevServerOcrAdapter", () => {
  it("한 장의 서류를 multipart 요청에 중복으로 넣지 않는다", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as FormData;
      expect(body.getAll("files")).toHaveLength(1);
      expect(body.getAll("file")).toHaveLength(0);
      return new Response(JSON.stringify({
        success: true,
        message: "ok",
        data: { text: "검진 결과", tables: [], status: "raw", automatically_confirmed: false },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new DevServerOcrAdapter("/api/v1").recognize(
      new File(["document"], "screening.jpg", { type: "image/jpeg" }),
    );

    expect(result.text).toBe("검진 결과");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("용량 제한 응답을 사용자가 이해할 수 있는 문구로 안내한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("too large", { status: 413 })));

    await expect(new DevServerOcrAdapter("/api/v1").recognize(
      new File(["document"], "screening.jpg", { type: "image/jpeg" }),
    )).rejects.toThrow("20MB 이하");
  });
});
