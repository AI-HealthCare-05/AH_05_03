/**
 * Static hosts may serve .gz as a compressed response or as a gzip file.
 * Fetch already decodes Content-Encoding; inspect the payload to avoid decoding twice.
 */
export async function decodeModelResponse(
  response: Response,
  expectedBytes: number,
  compressed: boolean,
): Promise<ArrayBuffer> {
  if (!response.ok) {
    throw new Error(`해부학 모델 청크를 불러오지 못했습니다 (${response.status})`);
  }
  const payload = await response.arrayBuffer();
  const signature = new Uint8Array(payload, 0, Math.min(2, payload.byteLength));
  const gzip = compressed && signature[0] === 0x1f && signature[1] === 0x8b;

  let buffer: ArrayBuffer;
  if (gzip && typeof DecompressionStream !== "undefined") {
    buffer = await new Response(
      new Blob([payload]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer();
  } else {
    buffer = payload;
  }

  if (buffer.byteLength !== expectedBytes) {
    throw new Error("해부학 모델 청크 데이터 크기가 일치하지 않습니다. 다시 시도해주세요.");
  }
  return buffer;
}
