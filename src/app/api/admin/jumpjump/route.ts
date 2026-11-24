import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { isAuthorized, limitRequest } from "@/lib/auth";
import { createServers, listServers } from "@/lib/db";
import { decryptConfig, encryptConfig } from "@/lib/crypto";
import { jumpJumpProfile } from "@/lib/jumpjump";
import { BodyLimitError, readBoundedBody } from "@/lib/bounded-body";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (!limitRequest(request) || !isAuthorized(request)) return Response.json({ error: "Unauthorized or rate limited" }, { status: 403, headers });
  try {
    const { profiles } = JSON.parse(await readBoundedBody(request, 4_000_000));
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
