import { createHash } from "node:crypto";

// Bind a legacy empty-list authorization to the exact stored catalog state.
// Enabling, editing, adding, or deleting records invalidates the authorization.
export function catalogGeneration(servers: { id: string; updatedAt: string; isEnabled: boolean }[]): string {
  const state = servers.map(server => [server.id, String(server.updatedAt), server.isEnabled])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}
