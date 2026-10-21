import { NextResponse } from "next/server";
import { listServers } from "@/lib/db";
import { decryptConfig } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const enabledServers = await listServers(true);
  const debugInfo = [];

  for (const s of enabledServers) {
    let decLen = 0;
    let decErr = null;
    try {
      const dec = decryptConfig(s.encryptedConfig);
      decLen = dec.length;
    } catch (e: any) {
      decErr = e.message;
    }

    debugInfo.push({
      id: s.id,
      name: s.name,
      protocol: s.protocol,
      host: s.host,
      decLen,
      decErr,
    });
  }

  return NextResponse.json({
    totalEnabled: enabledServers.length,
    servers: debugInfo,
  });
}
