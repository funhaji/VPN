import { NextResponse } from "next/server";
import { listServers } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const servers = await listServers(true);
  return NextResponse.json({
    servers: servers.map((server) => ({
      id: server.id,
      name: server.name,
      protocol: server.protocol,
      host: server.host,
      port: server.port,
      country: server.country,
      options: server.options,
      encryptedConfig: server.encryptedConfig,
      updatedAt: server.updatedAt,
    })),
  });
}
