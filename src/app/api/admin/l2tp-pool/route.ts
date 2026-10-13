import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isAuthorized, limitRequest } from "@/lib/auth";
import { decryptConfig } from "@/lib/crypto";
import { getL2tpSharedPool, listServers, setL2tpSharedPool, type L2tpPoolAccount } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await getL2tpSharedPool();
  const servers = await listServers(false);

  let sharedServersCount = 0;
  let totalL2tpServers = 0;

  for (const s of servers) {
    if (s.protocol.toLowerCase().startsWith("l2tp")) {
      totalL2tpServers++;
      try {
        const raw = decryptConfig(s.encryptedConfig);
        const parsed = JSON.parse(raw);
        if (parsed.authMode === "shared") {
          sharedServersCount++;
        }
      } catch {}
    }
  }

  return NextResponse.json({
    accounts,
    sharedServersCount,
    totalL2tpServers,
  });
}

export async function POST(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { accounts?: unknown };
    if (!Array.isArray(body.accounts)) {
      return NextResponse.json({ error: "Expected accounts array" }, { status: 400 });
    }

    const cleanAccounts: L2tpPoolAccount[] = [];
    for (const item of body.accounts) {
      if (item && typeof item === "object") {
        const u = String((item as Record<string, unknown>).username || "").trim();
        const p = String((item as Record<string, unknown>).password || "").trim();
        const k = String((item as Record<string, unknown>).psk || "").trim();
        const id = String(
          (item as Record<string, unknown>).id ||
            `pool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        );

        if (u && p) {
          cleanAccounts.push({
            id,
            username: u,
            password: p,
            ...(k ? { psk: k } : {}),
          });
        }
      }
    }

    await setL2tpSharedPool(cleanAccounts);
    revalidatePath("/api/servers");

    return NextResponse.json({ ok: true, count: cleanAccounts.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update L2TP pool" },
      { status: 500 },
    );
  }
}
