const ANATOMY_RESOURCE_CACHE = "ieobom-anatomy-resources-v1";

type CachedAnatomyFetchOptions = {
  signal?: AbortSignal;
  revision?: string;
};

function cacheRequest(url: string, revision?: string) {
  const cacheUrl = new URL(url, window.location.href);
  if (revision) cacheUrl.searchParams.set("__ieobom_revision", revision);
  return new Request(cacheUrl, { credentials: "same-origin" });
}

/**
 * 해부학 manifest·metadata·GLB 전용 캐시 우선 요청.
 *
 * Cache Storage를 사용할 수 없거나 브라우저가 저장을 거부하면 기존 fetch로
 * 자연스럽게 폴백한다. 응답 복사본만 캐시에 기록하므로 Three.js 파싱을 막지 않는다.
 */
export async function fetchCachedAnatomyResource(
  url: string,
  { signal, revision }: CachedAnatomyFetchOptions = {},
) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!("caches" in window)) return fetch(url, { signal });

  let cache: Cache;
  let request: Request;
  try {
    cache = await window.caches.open(ANATOMY_RESOURCE_CACHE);
    request = cacheRequest(url, revision);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    return fetch(url, { signal });
  }

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const response = await fetch(url, { signal });
  if (response.ok) {
    void cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
}
