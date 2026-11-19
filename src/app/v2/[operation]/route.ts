import { handleRequest } from "../../../../server-worker/src/index.mjs";
import { publicationStatus, publishCatalog } from "../../../../server-worker/src/storage.mjs";
import { compilePublicationCatalog } from "@/lib/server-catalog";
import { getAccessPolicy } from "@/lib/access-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let publishingPromise: Promise<void> | null = null;
async function ensurePublication() {
  try {
    const status = await publicationStatus(process.env);
    if (status.generation > 0) return;
  } catch {}
  if (!publishingPromise) {
    publishingPromise = (async () => {
      try {
        const catalog = await compilePublicationCatalog(false);
        const policy = await getAccessPolicy();
        await publishCatalog(catalog, policy, 0, process.env);
      } catch (err) {
        console.warn("[V2] Automatic publication initialization skipped:", err instanceof Error ? err.message : err);
      } finally {
        publishingPromise = null;
      }
    })();
  }
  await publishingPromise;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-astro-key, x-astro-time, x-astro-nonce, x-astro-signature, x-astro-version, x-astro-build",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  return Response.json(
    {
      status: "ok",
      api: "v2",
      operation,
      message:
        "Astro VPN V2 Gateway is operational. Client requests require HTTP POST with signed installation headers.",
    },
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...CORS_HEADERS,
      },
    },
  );
}

// Identical canonical /v2 paths and protocol on both hosts.
export async function POST(request: Request) {
  await ensurePublication();
  const res = await handleRequest(request, process.env);
  const newHeaders = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    if (!newHeaders.has(k)) {
      newHeaders.set(k, v);
    }
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: newHeaders,
  });
}
