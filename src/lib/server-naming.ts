import { getCountryMeta, normalizeLocationCode } from "@/lib/countries";

/**
 * Location-based server naming.
 *
 * Names look like "🇩🇪 Germany", "🇩🇪 Germany 2", "🇩🇪 Germany 3", ...
 * Numbering is per country (across all protocols) so every auto-generated
 * name is unique. This module is pure and shared by the admin UI (previews)
 * and the API (authoritative assignment).
 */

export type NamingServer = {
  id?: string;
  name: string;
  country: string;
};

const MAX_NAME_LENGTH = 70;

const LEADING_EMOJI = /^(?:[\u{1F1E6}-\u{1F1FF}]{2}|[\p{Emoji_Presentation}\p{Extended_Pictographic}])\s*/u;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripFlag = (value: string) => value.trim().replace(LEADING_EMOJI, "").replace(/^[-–—:\s]+/, "").trim();

const nameKey = (value: string) => stripFlag(value).replace(/\s+/g, " ").toLowerCase();

/** Resolve the country code of a server, falling back to its name. */
export const resolveServerCountry = (server: Pick<NamingServer, "name" | "country">): string => {
  const fromCountry = normalizeLocationCode(server.country);
  if (fromCountry !== "GLOBAL") return fromCountry;
  return normalizeLocationCode(server.name);
};

/** Base name for a country, e.g. "🇩🇪 Germany". Null if the location is unknown. */
export const locationBaseName = (countryCode: string): { flag: string; label: string } | null => {
  const code = normalizeLocationCode(countryCode);
  if (code === "GLOBAL") return null;
  const meta = getCountryMeta(code);
  return { flag: meta.flag, label: meta.name };
};

const formatName = (base: { flag: string; label: string }, index: number | null) => {
  const suffix = index === null ? "" : ` ${index}`;
  const label = base.label.slice(0, MAX_NAME_LENGTH - base.flag.length - 1 - suffix.length).trim();
  return `${base.flag} ${label}${suffix}`;
};

/**
 * Returns the number encoded in a name that follows the location pattern,
 * 1 for the bare base name ("Germany" counts as #1), or null if it doesn't match.
 */
const parseLocationIndex = (name: string, label: string): number | null => {
  const match = stripFlag(name).match(new RegExp(`^${escapeRegExp(label)}(?:\\s*#?\\s*(\\d+))?$`, "i"));
  if (!match) return null;
  return match[1] ? Math.max(1, Number.parseInt(match[1], 10)) : 1;
};

/**
 * Allocator for new servers. Each call to `next` returns the next free
 * location name for that country, taking previously allocated names in the
 * same batch into account.
 *
 * - First server of a country: "🇩🇪 Germany"
 * - Following ones: number = max(highest existing number, servers in country) + 1
 */
export const createAutoNamer = (existing: NamingServer[]) => {
  const usedNames = new Set(existing.map((server) => nameKey(server.name)));
  const perCountry = new Map<string, { count: number; maxIndex: number }>();

  const stateFor = (code: string, label: string) => {
    let state = perCountry.get(code);
    if (!state) {
      state = { count: 0, maxIndex: 0 };
      for (const server of existing) {
        if (resolveServerCountry(server) !== code) continue;
        state.count += 1;
        const index = parseLocationIndex(server.name, label);
        if (index !== null) state.maxIndex = Math.max(state.maxIndex, index);
      }
      perCountry.set(code, state);
    }
    return state;
  };

  return {
    /** Returns the generated name, or null if the country is unknown. */
    next(countryCode: string): string | null {
      const code = normalizeLocationCode(countryCode);
      const base = locationBaseName(code);
      if (!base) return null;
      const state = stateFor(code, base.label);

      let index: number | null = state.count === 0 && state.maxIndex === 0 ? null : Math.max(state.count, state.maxIndex) + 1;
      let name = formatName(base, index);
      while (usedNames.has(nameKey(name))) {
        index = (index ?? 1) + 1;
        name = formatName(base, index);
      }

      usedNames.add(nameKey(name));
      state.count += 1;
      state.maxIndex = Math.max(state.maxIndex, index ?? 1);
      return name;
    },
  };
};

/** Convenience: preview the name the next server in a country would get. */
export const previewAutoName = (existing: NamingServer[], countryCode: string, count = 1): string[] => {
  const namer = createAutoNamer(existing);
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const name = namer.next(countryCode);
    if (!name) break;
    names.push(name);
  }
  return names;
};

export type RenamePlanItem = {
  id: string;
  country: string;
  oldName: string;
  newName: string;
};

export type RenamePlan = {
  changes: RenamePlanItem[];
  unchanged: number;
  /** Targeted servers without a resolvable country (left untouched). */
  skipped: { id: string; name: string }[];
};

/**
 * Plan a bulk rename of servers to their location.
 *
 * `servers` must be the full list in display order (used to number servers
 * consistently). `targetIds` limits which servers get renamed; when omitted,
 * every server is renamed.
 *
 * Within a country: a lone server gets the bare name ("🇩🇪 Germany"), several
 * servers get "🇩🇪 Germany 1", "🇩🇪 Germany 2", ... in display order. When only
 * part of a country is targeted, numbers already used by untouched servers are
 * skipped so names never collide.
 */
export const planLocationRename = <T extends NamingServer & { id: string }>(
  servers: T[],
  targetIds?: Iterable<string>,
): RenamePlan => {
  const targets = targetIds ? new Set(targetIds) : null;
  const isTarget = (id: string) => !targets || targets.has(id);

  const groups = new Map<string, T[]>();
  const skipped: RenamePlan["skipped"] = [];
  for (const server of servers) {
    const code = resolveServerCountry(server);
    if (code === "GLOBAL") {
      if (isTarget(server.id)) skipped.push({ id: server.id, name: server.name });
      continue;
    }
    const group = groups.get(code);
    if (group) group.push(server);
    else groups.set(code, [server]);
  }

  // Names held by servers we are not touching must stay unique.
  const reservedNames = new Set(servers.filter((server) => !isTarget(server.id)).map((server) => nameKey(server.name)));

  const changes: RenamePlanItem[] = [];
  let unchanged = 0;

  for (const [code, group] of groups) {
    const base = locationBaseName(code);
    if (!base) continue;
    const targeted = group.filter((server) => isTarget(server.id));
    if (targeted.length === 0) continue;

    const assigned: string[] = [];
    if (targeted.length === group.length) {
      if (group.length === 1 && !reservedNames.has(nameKey(formatName(base, null)))) {
        assigned.push(formatName(base, null));
      } else {
        let index = 1;
        for (let i = 0; i < targeted.length; i += 1) {
          while (reservedNames.has(nameKey(formatName(base, index)))) index += 1;
          assigned.push(formatName(base, index));
          index += 1;
        }
      }
    } else {
      const usedIndexes = new Set<number>();
      for (const server of group) {
        if (isTarget(server.id)) continue;
        const parsed = parseLocationIndex(server.name, base.label);
        if (parsed !== null) usedIndexes.add(parsed);
      }
      let index = 1;
      for (let i = 0; i < targeted.length; i += 1) {
        while (usedIndexes.has(index) || reservedNames.has(nameKey(formatName(base, index)))) index += 1;
        assigned.push(formatName(base, index));
        index += 1;
      }
    }

    targeted.forEach((server, i) => {
      const newName = assigned[i];
      if (newName === server.name) {
        unchanged += 1;
      } else {
        changes.push({ id: server.id, country: code, oldName: server.name, newName });
      }
    });
  }

  return { changes, unchanged, skipped };
};
