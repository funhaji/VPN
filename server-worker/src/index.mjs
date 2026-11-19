import { gateway } from "./gateway.mjs";
import { createAdapter } from "./storage.mjs";

export async function handleRequest(request, env) {
  try { return await gateway(request, createAdapter(env)); }
  catch (error) {
    console.error("V2 gateway unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Service temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export default { fetch: handleRequest };
