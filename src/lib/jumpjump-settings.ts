import { getSetting, setSetting, invalidateServerCatalogCache } from "@/lib/db";
import { decryptConfig, encryptConfig } from "@/lib/crypto";
import { jumpJumpProfile } from "@/lib/jumpjump";
import type { JumpJumpEntry } from "@/lib/jumpjump-fetch";
import { createAutoNamer, type NamingServer } from "@/lib/server-naming";

export function nameJumpJumpServers<T extends NamingServer & { id: string }>(servers: T[], normal: NamingServer[]): T[] {
  const namer = createAutoNamer(normal);
  const used = new Set(normal.map(server => server.name.replace(/^🌐\s*/, "").trim().toLowerCase()));
  let globalIndex = 0;
  return [...servers].sort((a, b) => a.id.localeCompare(b.id)).map(entry => {
    let name = namer.next(entry.country);
    if (!name) {
      do { name = `🌐 Global ${++globalIndex}`; } while (used.has(name.replace(/^🌐\s*/, "").toLowerCase()));
    }
    used.add(name.replace(/^🌐\s*/, "").trim().toLowerCase());
    return { ...entry, name };
  });
}

export function isJumpJumpServer(server: { protocol?: string; runtimeProfile?: { engine?: unknown } }): boolean {
  return server.protocol?.toLowerCase().startsWith("jumpjump:") === true || server.runtimeProfile?.engine === "xray-jumpjump";
}

export async function jumpJumpEnabled(): Promise<boolean> {
  return (await getSetting("jumpjump_enabled")) !== "false";
}

export async function setJumpJumpEnabled(enabled: boolean) {
  await setSetting("jumpjump_enabled", String(enabled));
  invalidateServerCatalogCache();
}

export async function jumpJumpSnapshot(): Promise<{ fetchedAt: string | null; servers: JumpJumpEntry[] }> {
  const raw = await getSetting("jumpjump_snapshot");
  if (!raw) return { fetchedAt: null, servers: [] };
  const snapshot = JSON.parse(decryptConfig(JSON.parse(raw)));
  if (!Array.isArray(snapshot.servers) || snapshot.servers.length > 500) throw new Error("Invalid JumpJump snapshot");
  return { fetchedAt: snapshot.fetchedAt, servers: snapshot.servers.map((entry: JumpJumpEntry) => ({ ...entry,
    runtimeProfile: jumpJumpProfile(JSON.parse(entry.rawConfig)) })) };
}

export async function saveJumpJumpSnapshot(servers: JumpJumpEntry[]) {
  if (!servers.length) throw new Error("Refusing empty JumpJump snapshot");
  await setSetting("jumpjump_snapshot", JSON.stringify(encryptConfig(JSON.stringify({ fetchedAt: new Date().toISOString(), servers }))));
  invalidateServerCatalogCache();
}
