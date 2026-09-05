import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCachedAnatomyResource } from "./anatomyResourceCache";

describe("anatomy resource cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("캐시된 해부 자산은 네트워크 요청 없이 반환한다", async () => {
    const cachedResponse = new Response("cached-model");
    const match = vi.fn().mockResolvedValue(cachedResponse);
    const fetchMock = vi.fn();
    vi.stubGlobal("caches", { open: vi.fn().mockResolvedValue({ match, put: vi.fn() }) });
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchCachedAnatomyResource("/model.glb", { revision: "sha-1" });

    expect(await response.text()).toBe("cached-model");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(match.mock.calls[0][0].url)).toContain("__ieobom_revision=sha-1");
  });

  it("최초 네트워크 응답을 캐시에 기록한다", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("caches", {
      open: vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined), put }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("new-model", { status: 200 })));

    const response = await fetchCachedAnatomyResource("/model.glb", { revision: "sha-2" });

    expect(await response.text()).toBe("new-model");
    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
  });

  it("Cache Storage를 사용할 수 없으면 기존 fetch로 폴백한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("network-model"));
    vi.stubGlobal("caches", undefined);
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchCachedAnatomyResource("/model.glb");

    expect(await response.text()).toBe("network-model");
    expect(fetchMock).toHaveBeenCalledWith("/model.glb", { signal: undefined });
  });
});
