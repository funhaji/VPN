import { handleRequest } from "../../../../server-worker/src/index.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Identical canonical /v2 paths and protocol on both hosts.
export async function POST(request: Request) {
  return handleRequest(request, process.env);
}
