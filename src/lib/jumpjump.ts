type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => Boolean(value && typeof value === "object" && !Array.isArray(value));

// Auxiliary detours are part of this versioned profile, not a share URI.
export function jumpJumpProfile(value: unknown) {
  if (!object(value) || value.provider !== "jumpjump" || value.version !== 1 || !object(value.outbound) || !Array.isArray(value.extra_outbounds)) throw new Error("Invalid JumpJump envelope");
  const outbounds = [value.outbound, ...value.extra_outbounds];
  if (outbounds.length > 32 || outbounds.some(entry => !object(entry))) throw new Error("Invalid JumpJump outbounds");
  if (!["vless", "trojan"].includes(String(value.outbound.protocol))) throw new Error("Unsupported JumpJump protocol");
  const tags = new Set<string>();
  const edges = new Map<string, string[]>();
  for (const entry of outbounds as ObjectValue[]) {
    if (typeof entry.tag !== "string" || !entry.tag || tags.has(entry.tag)) throw new Error("JumpJump requires unique outbound tags");
    tags.add(entry.tag);
  }
  for (const entry of outbounds as ObjectValue[]) {
    const proxy = object(entry.proxySettings) ? entry.proxySettings.tag : undefined;
    const dialer = object(entry.streamSettings) && object(entry.streamSettings.sockopt) ? entry.streamSettings.sockopt.dialerProxy : undefined;
    const references = [proxy, dialer].filter(value => value !== undefined);
    if (references.some(value => typeof value !== "string" || !tags.has(value))) throw new Error("Missing JumpJump detour");
    edges.set(entry.tag as string, references as string[]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(tag: string) {
    if (visiting.has(tag)) throw new Error("Cyclic JumpJump detour");
    if (visited.has(tag)) return;
    visiting.add(tag);
    for (const next of edges.get(tag) || []) visit(next);
    visiting.delete(tag); visited.add(tag);
  }
  for (const tag of tags) visit(tag);
  return { engine: "xray-jumpjump", supported: true,
    outbound: { type: "jumpjump", provider: "jumpjump", version: 1, outbound: value.outbound, extra_outbounds: value.extra_outbounds } };
}
