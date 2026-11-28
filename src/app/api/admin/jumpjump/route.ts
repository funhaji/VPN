import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { isAuthorized, limitRequest } from "@/lib/auth";
import { createServers, listServers } from "@/lib/db";
import { decryptConfig, encryptConfig } from "@/lib/crypto";
import { jumpJumpProfile } from "@/lib/jumpjump";
import { BodyLimitError, readBoundedBody } from "@/lib/bounded-body";
import { jumpJumpEnabled, setJumpJumpEnabled, jumpJumpSnapshot, saveJumpJumpSnapshot, nameJumpJumpServers, isJumpJumpServer } from "@/lib/jumpjump-settings";
import { fetchJumpJump, providerApi } from "@/lib/jumpjump-fetch";
import { compilePublicationCatalog } from "@/lib/server-catalog";
import { getAccessPolicy } from "@/lib/access-policy";
import { createAdapter, publicationStatus, publishCatalog } from "../../../../../server-worker/src/storage.mjs";

export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store" };

async function publishJumpJumpChange() {
  const status = await publicationStatus(process.env);
  const previous = status.generation > 0 ? await createAdapter(process.env).publication() : null;
  if (previous && !await jumpJumpEnabled()) {
    // Disabling must work even if unrelated draft profiles need repair.
    const servers = previous.snapshot.servers.filter((server: Parameters<typeof isJumpJumpServer>[0]) => !isJumpJumpServer(server));
    await publishCatalog({ servers, allServersRemoved: servers.length === 0 }, previous.policy, status.generation, process.env);
    return;
  }
  let catalog;
  try { catalog = await compilePublicationCatalog(); }
  catch (error) {
    // Explicitly disabling the only free provider is an intentional empty
    // catalog, not a network failure. Never authorize parser failures.
    if (!(error instanceof Error) || error.message !== "Empty catalog is not authorized") throw error;
    catalog = await compilePublicationCatalog(true);
  }
  if (previous) {
    // A provider toggle must not deploy unrelated, unpublished admin edits.
    // Keep normal profiles and policy exactly as currently published.
    const normal = previous.snapshot.servers.filter((server: Parameters<typeof isJumpJumpServer>[0]) => !isJumpJumpServer(server));
    const servers = [...normal, ...nameJumpJumpServers(catalog.servers.filter(isJumpJumpServer), normal)];
    catalog = { servers, allServersRemoved: servers.length === 0 };
  }
  await publishCatalog(catalog, previous?.policy ?? await getAccessPolicy(), status.generation, process.env);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const [enabled, snapshot] = await Promise.all([jumpJumpEnabled(), jumpJumpSnapshot()]);
    return Response.json({ enabled, fetchedAt: snapshot.fetchedAt, count: snapshot.servers.length }, { headers });
  } catch { return Response.json({ error: "JumpJump settings unavailable" }, { status: 503, headers }); }
}

export async function PATCH(request: NextRequest) {
  if (!limitRequest(request) || !isAuthorized(request)) return Response.json({ error: "Unauthorized or rate limited" }, { status: 403, headers });
  if (request.headers.get("origin") !== request.nextUrl.origin) return Response.json({ error: "Origin mismatch" }, { status: 403, headers });
  try {
    const body = JSON.parse(await readBoundedBody(request, 1024));
    if (typeof body.enabled !== "boolean") throw new Error();
    await setJumpJumpEnabled(body.enabled);
    await publishJumpJumpChange();
    return Response.json({ enabled: body.enabled, published: true }, { headers });
  } catch { return Response.json({ error: "JumpJump change could not be published. Check Catalog & Safety publication status and retry; clients keep the last published catalog until publication succeeds." }, { status: 503, headers }); }
}

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (!limitRequest(request) || !isAuthorized(request)) return Response.json({ error: "Unauthorized or rate limited" }, { status: 403, headers });
  try {
    const { profiles, action } = JSON.parse(await readBoundedBody(request, 4_000_000));
    if (action === "refresh") {
      if (request.headers.get("origin") !== request.nextUrl.origin) return Response.json({ error: "Origin mismatch" }, { status: 403, headers });
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(100_000)]);
      const servers = await fetchJumpJump(providerApi(signal));
      await saveJumpJumpSnapshot(servers);
      await publishJumpJumpChange();
      return Response.json({ count: servers.length, fetchedAt: new Date().toISOString(), published: true }, { headers });
    }
    if (!Array.isArray(profiles) || profiles.length < 1 || profiles.length > 500) throw new Error();
    const existing = new Set((await listServers(false)).filter(s => s.protocol.startsWith("jumpjump:")).map(s => decryptConfig(s.encryptedConfig)));
    const items = [];
    for (const row of profiles) {
      jumpJumpProfile(row.profile);
      if (typeof row.name !== "string" || !row.name.startsWith("JumpJump") || row.name.length > 70) throw new Error();
      const raw = JSON.stringify(row.profile);
      if (raw.length > 100_000) throw new Error();
      if (existing.has(raw)) continue;
      existing.add(raw);
      items.push({ id: randomUUID(), name: row.name, protocol: `jumpjump:${row.profile.outbound.protocol}`,
        host: "embedded-config", port: 443, country: "GLOBAL", isEnabled: true,
        options: { mux: false, fragment: false, sniffing: true, allowInsecure: false, extra: {} }, encryptedConfig: encryptConfig(raw) });
    }
    await createServers(items);
    return Response.json({ imported: items.length, skipped: profiles.length - items.length }, { headers });
  } catch (error) { return Response.json({ error: "JumpJump import failed; invalid or unavailable catalog" }, { status: error instanceof BodyLimitError ? 413 : 400, headers }); }
}
