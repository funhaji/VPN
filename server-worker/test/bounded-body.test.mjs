import test from "node:test";
import assert from "node:assert/strict";
import { BodyLimitError, readBoundedBody } from "../../src/lib/bounded-body.ts";

test("body reader preserves signed bytes and handles empty bodies", async () => {
  const text = '{"key":"آزمایش"}\n';
  assert.equal(await readBoundedBody(new Request("https://example.test", { method: "POST", body: text }), 100), text);
  assert.equal(await readBoundedBody(new Request("https://example.test"), 100), "");
});
test("body reader rejects excessive or invalid declared size before reading", async () => {
  for (const size of ["101", "-1", "abc"]) {
    await assert.rejects(readBoundedBody({ body: null, headers: new Headers({ "content-length": size }) }, 100), BodyLimitError);
  }
});
test("body reader enforces streamed byte limits, cancels and releases the stream", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(60)); controller.enqueue(new Uint8Array(60)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readBoundedBody({ body, headers: new Headers() }, 100), BodyLimitError);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});
