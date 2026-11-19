import { listServers } from "@/lib/db";
import { decryptConfig } from "@/lib/crypto";
import { findServerDuplicates, type DuplicateCandidate } from "@/lib/server-duplicates";

export async function checkServerDuplicates(incoming: DuplicateCandidate[], excludedIds: string[] = []) {
  const excluded = new Set(excludedIds);
  const existing = (await listServers(false)).filter(server => !excluded.has(server.id)).map(server => ({
    ...server, rawConfig: decryptConfig(server.encryptedConfig),
  }));
  return findServerDuplicates(incoming, existing);
}
