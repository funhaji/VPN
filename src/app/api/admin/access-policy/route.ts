import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { accessPolicySchema, getAccessPolicy, saveAccessPolicy } from "@/lib/access-policy";
import { listServers } from "@/lib/db";
import { catalogGeneration } from "@/lib/catalog-generation";

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getAccessPolicy(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const parsed = accessPolicySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid access policy" }, { status: 400 });
  if (parsed.data.allServersRemoved) {
    const servers = await listServers(false);
    if (servers.some(server => server.isEnabled)) {
      return NextResponse.json({ error: "Disable or remove all enabled servers before authorizing an empty catalog." }, { status: 409 });
    }
    parsed.data.removalGeneration = catalogGeneration(servers);
  } else {
    delete parsed.data.removalGeneration;
  }
  await saveAccessPolicy(parsed.data);

  // Automatically republish V2 with the updated policy so changes take effect immediately
  try {
    const { publicationStatus, publishCatalog } = await import("../../../../../server-worker/src/storage.mjs");
    const { compilePublicationCatalog } = await import("@/lib/server-catalog");
    const status = await publicationStatus(process.env);
    const catalog = await compilePublicationCatalog(parsed.data.allServersRemoved === true);
    await publishCatalog(catalog, parsed.data, status.generation, process.env);
  } catch (err) {
    console.warn("[AccessPolicy] Auto-republish failed:", err);
  }

  return NextResponse.json({ ok: true });
}
