import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/auth";
import { getAccessPolicy } from "@/lib/access-policy";
import { compilePublicationCatalog } from "@/lib/server-catalog";
import { publicationStatus, publishCatalog } from "../../../../../server-worker/src/storage.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await publicationStatus(process.env), { headers });
  } catch {
    return NextResponse.json({ error: "V2 publication unavailable or not configured" }, { status: 503, headers });
  }
}

const schema = z.object({ expectedGeneration: z.number().int().nonnegative(), allServersRemoved: z.boolean().default(false) });
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid publication request" }, { status: 400 });
  try {
    const catalog = await compilePublicationCatalog(input.data.allServersRemoved);
    const policy = await getAccessPolicy();
    const result = await publishCatalog(catalog, policy, input.data.expectedGeneration, process.env);
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch {
    return NextResponse.json({ error: "Publication failed. Check enabled profiles, empty-catalog authorization, storage configuration, and current generation." }, { status: 409, headers });
  }
}
