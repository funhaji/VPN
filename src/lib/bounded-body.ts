export class BodyLimitError extends Error {}

/** Enforce a byte limit while streaming, even without a Content-Length header. */
export async function readBoundedBody(source: Pick<Request, "body" | "headers">, maxBytes: number): Promise<string> {
  const declared = source.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new BodyLimitError("Request too large");
  const reader = source.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new BodyLimitError("Request too large");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
