import { gateway } from "./gateway.mjs";
import { createAdapter } from "./storage.mjs";

export async function handleRequest(request, env) {
  try { return await gateway(request, createAdapter(env)); }
  catch { return Response.json({ error: "Service temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}

export default { fetch: handleRequest };
