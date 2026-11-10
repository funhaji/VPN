import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import postgres, { type Sql } from "postgres";
import { decryptConfig, encryptConfig } from "@/lib/crypto";
import type { ProtocolOptions, ServerRecord } from "@/types/server";
import { getNeonUrl, getSupabaseUrl } from "@/lib/env";
import { revalidateTag } from "next/cache";
import { getCountryMeta, getCountryNameFa, normalizeLocationCode } from "@/lib/countries";

export type DbProvider = "neon" | "supabase";

let neonClient: NeonQueryFunction<false, false> | null = null;
let supabaseClient: Sql | null = null;

const cooldownUntil: Record<DbProvider, number> = {
  neon: 0,
  supabase: 0,
};

const quotaCooldownUntil: Record<DbProvider, number> = {
  neon: 0,
  supabase: 0,
};

export const isProviderQuotaLimited = (provider: DbProvider): boolean =>
  Date.now() < quotaCooldownUntil[provider];

const schemaReady: Record<DbProvider, boolean> = {
  neon: false,
  supabase: false,
};

let legacyMigrationChecked = false;
let readCounter = 0;
let catalogCacheVersion = 0;
let autoSyncRunning = false;
let reconcileTimer: NodeJS.Timeout | null = null;

const heartbeatDebounce = new Map<string, { timestamp: number; appVersion: string }>();

export const getCatalogCacheVersion = (): number => catalogCacheVersion;

export const PUBLIC_DATA_TAG = "public-data";

export const invalidateServerCatalogCache = (): void => {
  catalogCacheVersion += 1;
  // Also expire the shared (cross-instance) Data Cache used by public routes.
  try {
    revalidateTag(PUBLIC_DATA_TAG, { expire: 0 });
  } catch {
    // Called outside a request (e.g. background timer) — in-memory bump is enough.
  }
};

const getNeonClient = (): NeonQueryFunction<false, false> | null => {
  const url = getNeonUrl();
  if (!url) return null;
  if (!neonClient) {
    neonClient = neon(url);
  }
  return neonClient;
};

const getSupabaseClient = (): Sql | null => {
  const url = getSupabaseUrl();
  if (!url) return null;
  if (!supabaseClient) {
    supabaseClient = postgres(url, {
      max: 5,
      prepare: false,
      idle_timeout: 15,
      connect_timeout: 5,
      timeout: 7,
    });
  }
  return supabaseClient;
};

export const getConfiguredProviders = (): DbProvider[] => {
  const providers: DbProvider[] = [];
  if (getSupabaseUrl()) providers.push("supabase");
  if (getNeonUrl() && process.env.DISABLE_NEON !== "true" && process.env.DISABLE_NEON !== "1") {
    providers.push("neon");
  }
  return providers;
};

const isProviderHealthy = (provider: DbProvider): boolean =>
  Date.now() >= cooldownUntil[provider];

const markProviderError = (provider: DbProvider, error: unknown): void => {
  const msg = error instanceof Error ? error.message : String(error);
  const isQuota = msg.includes("402") || msg.includes("quota") || msg.includes("exceeded");
  if (isQuota) {
    quotaCooldownUntil[provider] = Date.now() + 24 * 3600_000;
  }
  const duration = isQuota ? 24 * 3600_000 : 15_000;
  cooldownUntil[provider] = Date.now() + duration;
  console.warn(`[DB Provider] Marked ${provider} unhealthy for ${duration / 1000}s (${msg.slice(0, 120)})`);
};

const DDL_SCRIPT = `
  CREATE TABLE IF NOT EXISTS vpn_servers (
    id UUID PRIMARY KEY,
    name VARCHAR(70) NOT NULL,
    protocol VARCHAR(40) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INT NOT NULL,
    country VARCHAR(80) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    options_json TEXT NOT NULL,
    config_cipher TEXT NOT NULL,
    config_salt TEXT,
    config_iv TEXT NOT NULL,
    config_tag TEXT NOT NULL,
    config_version INT NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS config_salt TEXT;
  ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS config_version INT NOT NULL DEFAULT 1;
  ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_vpn_servers_enabled ON vpn_servers(is_enabled);
  CREATE TABLE IF NOT EXISTS routing_rules (
    id UUID PRIMARY KEY,
    type VARCHAR(20) NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_routing_rules_type_value ON routing_rules(type, value);
  CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS client_devices (
    device_id VARCHAR(128) PRIMARY KEY,
    platform VARCHAR(32) NOT NULL,
    app_version VARCHAR(32) NOT NULL,
    os_version VARCHAR(64) NOT NULL DEFAULT '',
    model VARCHAR(64) NOT NULL DEFAULT '',
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_client_devices_platform ON client_devices(platform);
  CREATE INDEX IF NOT EXISTS idx_client_devices_last_seen ON client_devices(last_seen);
`;

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS vpn_servers (
    id UUID PRIMARY KEY,
    name VARCHAR(70) NOT NULL,
    protocol VARCHAR(40) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INT NOT NULL,
    country VARCHAR(80) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    options_json TEXT NOT NULL,
    config_cipher TEXT NOT NULL,
    config_salt TEXT,
    config_iv TEXT NOT NULL,
    config_tag TEXT NOT NULL,
    config_version INT NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS config_salt TEXT`,
  `ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS config_version INT NOT NULL DEFAULT 1`,
  `ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_vpn_servers_enabled ON vpn_servers(is_enabled)`,
  `CREATE TABLE IF NOT EXISTS routing_rules (
    id UUID PRIMARY KEY,
    type VARCHAR(20) NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_routing_rules_type_value ON routing_rules(type, value)`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS client_devices (
    device_id VARCHAR(128) PRIMARY KEY,
    platform VARCHAR(32) NOT NULL,
    app_version VARCHAR(32) NOT NULL,
    os_version VARCHAR(64) NOT NULL DEFAULT '',
    model VARCHAR(64) NOT NULL DEFAULT '',
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_client_devices_platform ON client_devices(platform)`,
  `CREATE INDEX IF NOT EXISTS idx_client_devices_last_seen ON client_devices(last_seen)`
];

export const ensureSchemaForProvider = async (provider: DbProvider): Promise<void> => {
  if (schemaReady[provider]) return;

  if (provider === "neon") {
    const client = getNeonClient();
    if (!client) throw new Error("Neon DB is not configured");
    for (const stmt of DDL_STATEMENTS) {
      await runWithTimeout(client.query(stmt, []), 7000);
    }
  } else {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase DB is not configured");
    await client.unsafe(DDL_SCRIPT);
  }

  schemaReady[provider] = true;
};

export const ensureSchema = async (): Promise<void> => {
  const configured = getConfiguredProviders();
  if (configured.length === 0) {
    throw new Error("No database configured (set NEON_DATABASE_URL or SUPABASE_DATABASE_URL)");
  }

  const results = await Promise.allSettled(
    configured.map((provider) => ensureSchemaForProvider(provider)),
  );

  const errors: string[] = [];
  results.forEach((res, idx) => {
    if (res.status === "rejected") {
      errors.push(`${configured[idx]}: ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`);
    }
  });

  if (results.every((r) => r.status === "rejected")) {
    throw new Error(`Failed to ensure schema on any database: ${errors.join("; ")}`);
  }
};

async function runWithTimeout<R>(promise: Promise<R>, timeoutMs = 7000): Promise<R> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Database operation timed out after " + timeoutMs + "ms")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const executeOnProvider = async <T = unknown>(
  provider: DbProvider,
  strings: TemplateStringsArray,
  values: unknown[],
): Promise<T[]> => {
  try {
    if (provider === "neon") {
      const client = getNeonClient();
      if (!client) throw new Error("Neon DB is not configured");
      const rows = await runWithTimeout(client(strings, ...(values as any[])), 6000);
      return (rows as unknown as T[]) ?? [];
    }

    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase DB is not configured");

    const normalizedValues = values.map((val, idx) => {
      if (typeof val === "string" && (val.startsWith("[") || val.startsWith("{"))) {
        const preceding = strings[idx] || "";
        const following = strings[idx + 1] || "";
        if (
          preceding.includes("jsonb_to_recordset") ||
          preceding.includes("json_to_recordset") ||
          following.includes("::jsonb") ||
          following.includes("::json")
        ) {
          try {
            return JSON.parse(val);
          } catch {
            return val;
          }
        }
      }
      return val;
    });

    const rows = await runWithTimeout(client(strings, ...(normalizedValues as any[])), 7000);
    return (rows as unknown as T[]) ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if ((msg.includes("42P01") || msg.includes("does not exist")) && !schemaReady[provider]) {
      await ensureSchemaForProvider(provider);
      return executeOnProvider<T>(provider, strings, values);
    }
    throw err;
  }
};

export const executeSql = <T = unknown>(provider: DbProvider) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    return executeOnProvider<T>(provider, strings, values);
  };
};

let lastUsedProvider: DbProvider | null = null;
export const getLastUsedProvider = (): DbProvider | null => lastUsedProvider;

export const queryRead = async <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> => {
  const configured = getConfiguredProviders();
  if (configured.length === 0) {
    throw new Error("No database configured (neither Neon nor Supabase URL provided)");
  }

  const healthy = configured.filter(isProviderHealthy);
  const candidates = healthy.length > 0 ? healthy : configured;

  const primary = candidates[0];
  const secondary = configured.find((p) => p !== primary && isProviderHealthy(p));

  try {
    const res = await executeOnProvider<T>(primary, strings, values);
    lastUsedProvider = primary;
    return res;
  } catch (err) {
    markProviderError(primary, err);

    if (secondary && secondary !== primary) {
      try {
        const res = await executeOnProvider<T>(secondary, strings, values);
        lastUsedProvider = secondary;
        return res;
      } catch (secErr) {
        markProviderError(secondary, secErr);
        throw secErr;
      }
    }
    throw err;
  }
};

export const scheduleServerReconciliation = (): void => {
  if (reconcileTimer) return;
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    if (!autoSyncRunning && isProviderHealthy("neon") && !isProviderQuotaLimited("neon")) {
      autoSyncRunning = true;
      reconcileServersToNeon()
        .catch((e) => console.warn("[Background Sync] Server reconciliation failed:", e))
        .finally(() => {
          autoSyncRunning = false;
        });
    }
  }, 4000);
};

export const queryWrite = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> => writeToProviders<T>(true, strings, values);

/** Write that does NOT invalidate the public server catalog (e.g. heartbeats). */
export const queryWriteNoInvalidate = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> => writeToProviders<T>(false, strings, values);

const writeToProviders = async <T = unknown>(
  invalidate: boolean,
  strings: TemplateStringsArray,
  values: unknown[],
): Promise<T[]> => {
  const configured = getConfiguredProviders();
  if (configured.length === 0) {
    throw new Error("No database configured (neither Neon nor Supabase URL provided)");
  }

  // Always attempt writes to all configured providers unless quota-limited
  const nonQuotaTargets = configured.filter((p) => !isProviderQuotaLimited(p));
  const targets = nonQuotaTargets.length > 0 ? nonQuotaTargets : configured;

  if (targets.length === 1) {
    const single = targets[0];
    try {
      const res = await executeOnProvider<T>(single, strings, values);
      if (invalidate) invalidateServerCatalogCache();
      return res;
    } catch (err) {
      markProviderError(single, err);
      throw err;
    }
  }

  const results = await Promise.allSettled(
    targets.map((p) => executeOnProvider<T>(p, strings, values)),
  );

  let successResult: T[] | null = null;
  const errors: string[] = [];
  let neonFailed = false;

  results.forEach((res, idx) => {
    const provider = targets[idx];
    if (res.status === "fulfilled") {
      if (!successResult) successResult = res.value;
    } else {
      markProviderError(provider, res.reason);
      if (provider === "neon") {
        neonFailed = true;
      }
      errors.push(`${provider}: ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`);
    }
  });

  if (successResult !== null) {
    if (invalidate) invalidateServerCatalogCache();
    // If Supabase succeeded but Neon failed, schedule automatic reconciliation so Neon catches up
    if (neonFailed && targets.includes("supabase")) {
      scheduleServerReconciliation();
    }
    return successResult;
  }

  throw new Error(`Write failed on all databases: ${errors.join("; ")}`);
};

type DatabaseServer = {
  id: string;
  name: string;
  protocol: string;
  host: string;
  port: number;
  country: string;
  is_enabled: boolean;
  options_json: string;
  config_cipher: string;
  config_salt: string | null;
  config_iv: string;
  config_tag: string;
  config_version: number | null;
  sort_order: number;
  notice?: string | null;
  created_at: string;
  updated_at: string;
};

const parseOptions = (raw: unknown): ProtocolOptions => {
  const fallback: ProtocolOptions = {
    mux: false,
    fragment: false,
    sniffing: true,
    allowInsecure: false,
    extra: {},
  };
  if (!raw || raw === "undefined" || raw === "null") return fallback;
  if (typeof raw === "object") return raw as ProtocolOptions;
  try {
    const parsed = JSON.parse(String(raw));
    return (parsed && typeof parsed === "object") ? (parsed as ProtocolOptions) : fallback;
  } catch {
    return fallback;
  }
};

const formatIsoDate = (val: unknown): string => {
  if (!val) return new Date().toISOString();
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? new Date().toISOString() : val.toISOString();
  }
  const d = new Date(String(val));
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};

const mapServer = (row: DatabaseServer): ServerRecord => {
  const options = parseOptions(row.options_json);
  const notice = typeof options.extra?.notice === "string" && options.extra.notice.trim()
    ? options.extra.notice.trim()
    : (row.notice ? String(row.notice).trim() : undefined);
  return {
    id: String(row.id || ""),
    name: String(row.name || ""),
    protocol: String(row.protocol || ""),
    host: String(row.host || ""),
    port: Number(row.port) || 443,
    country: String(row.country || ""),
    isEnabled: Boolean(row.is_enabled),
    options,
    notice,
    encryptedConfig: {
      version: row.config_version ?? undefined,
      cipherText: String(row.config_cipher || ""),
      salt: row.config_salt ?? undefined,
      iv: String(row.config_iv || ""),
      authTag: String(row.config_tag || ""),
    },
    sortOrder: Number(row.sort_order) || 0,
    createdAt: formatIsoDate(row.created_at),
    updatedAt: formatIsoDate(row.updated_at),
  };
};

const migrateLegacyEncryption = async (): Promise<void> => {
  if (legacyMigrationChecked) return;

  try {
    const rows = (await queryRead`
      SELECT id, config_cipher, config_salt, config_iv, config_tag, config_version
      FROM vpn_servers
      WHERE config_version IS NULL OR config_version < 2 OR config_salt IS NULL OR config_salt = ''
    `) as Array<
      Pick<
        DatabaseServer,
        "id" | "config_cipher" | "config_salt" | "config_iv" | "config_tag" | "config_version"
      >
    >;

    if (rows.length === 0) {
      legacyMigrationChecked = true;
      return;
    }

    for (const row of rows) {
      try {
        const plainText = decryptConfig({
          version: row.config_version ?? undefined,
          cipherText: row.config_cipher,
          salt: row.config_salt ?? undefined,
          iv: row.config_iv,
          authTag: row.config_tag,
        });
        const upgraded = encryptConfig(plainText);
        await queryWrite`
          UPDATE vpn_servers
          SET
            config_cipher = ${upgraded.cipherText},
            config_salt = ${upgraded.salt ?? null},
            config_iv = ${upgraded.iv},
            config_tag = ${upgraded.authTag},
            config_version = ${upgraded.version ?? 2},
            updated_at = NOW()
          WHERE id = ${row.id};
        `;
      } catch {}
    }
  } catch {}

  legacyMigrationChecked = true;
};

export const migrateServerEncryption = async (): Promise<{ migrated: number; failed: number }> => {
  const rows = (await queryRead`
    SELECT id, config_cipher, config_salt, config_iv, config_tag, config_version
    FROM vpn_servers
    WHERE config_version IS NULL OR config_version < 2 OR config_salt IS NULL OR config_salt = ''
  `) as Array<
    Pick<
      DatabaseServer,
      "id" | "config_cipher" | "config_salt" | "config_iv" | "config_tag" | "config_version"
    >
  >;

  let migrated = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const plainText = decryptConfig({
        version: row.config_version ?? undefined,
        cipherText: row.config_cipher,
        salt: row.config_salt ?? undefined,
        iv: row.config_iv,
        authTag: row.config_tag,
      });
      const upgraded = encryptConfig(plainText);
      await queryWrite`
        UPDATE vpn_servers
        SET
          config_cipher = ${upgraded.cipherText},
          config_salt = ${upgraded.salt ?? null},
          config_iv = ${upgraded.iv},
          config_tag = ${upgraded.authTag},
          config_version = ${upgraded.version ?? 2},
          updated_at = NOW()
        WHERE id = ${row.id};
      `;
      migrated += 1;
    } catch {
      failed += 1;
    }
  }

  legacyMigrationChecked = true;
  return { migrated, failed };
};

export const listServers = async (enabledOnly: boolean): Promise<ServerRecord[]> => {
  await migrateLegacyEncryption();
  const rows = (enabledOnly
    ? await queryRead`
      SELECT * FROM vpn_servers WHERE is_enabled = TRUE ORDER BY sort_order ASC, created_at DESC
    `
    : await queryRead`
      SELECT * FROM vpn_servers ORDER BY sort_order ASC, created_at DESC
    `) as DatabaseServer[];
  return rows.map((row) => mapServer(row));
};

export type LocationStatItem = {
  code: string;
  name: string;
  nameFa: string;
  flag: string;
  count: number;
};

export type ActiveLocationsStats = {
  totalServers: number;
  enabledServers: number;
  locationCount: number;
  countries: LocationStatItem[];
};

export const getActiveLocationsStats = async (): Promise<ActiveLocationsStats> => {
  const rows = (await queryRead`
    SELECT country, is_enabled FROM vpn_servers
  `) as Array<{ country: string; is_enabled: boolean }>;

  const totalServers = rows.length;
  const enabledServers = rows.filter((r) => r.is_enabled).length;

  const countryCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.is_enabled || !row.country) continue;
    const code = normalizeLocationCode(row.country);
    if (code && code !== "UNKNOWN") {
      countryCounts.set(code, (countryCounts.get(code) ?? 0) + 1);
    }
  }

  const countries: LocationStatItem[] = Array.from(countryCounts.entries())
    .map(([code, count]) => {
      const meta = getCountryMeta(code);
      return {
        code,
        name: meta.name,
        nameFa: getCountryNameFa(code),
        flag: meta.flag,
        count,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    totalServers,
    enabledServers,
    locationCount: countries.length,
    countries,
  };
};

export const createServer = async (input: {
  id: string;
  name: string;
  protocol: string;
  host: string;
  port: number;
  country: string;
  isEnabled: boolean;
  options: ProtocolOptions;
  encryptedConfig: { version?: number; cipherText: string; salt?: string; iv: string; authTag: string };
  sortOrder?: number;
}): Promise<void> => {
  if (input.sortOrder === undefined) {
    await queryWrite`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order ASC, created_at DESC) - 1 AS new_rank
        FROM vpn_servers
      )
      UPDATE vpn_servers AS s
      SET sort_order = ranked.new_rank + 1
      FROM ranked
      WHERE s.id = ranked.id;
    `;
  }

  await queryWrite`
    INSERT INTO vpn_servers (
      id, name, protocol, host, port, country, is_enabled, options_json, config_cipher, config_salt, config_iv, config_tag, config_version, sort_order
    ) VALUES (
      ${input.id},
      ${input.name},
      ${input.protocol},
      ${input.host},
      ${input.port},
      ${input.country},
      ${input.isEnabled},
      ${JSON.stringify(input.options)},
      ${input.encryptedConfig.cipherText},
      ${input.encryptedConfig.salt ?? null},
      ${input.encryptedConfig.iv},
      ${input.encryptedConfig.authTag},
      ${input.encryptedConfig.version ?? 2},
      ${input.sortOrder ?? 0}
    );
  `;
};

export const createServers = async (
  items: Array<{
    id: string;
    name: string;
    protocol: string;
    host: string;
    port: number;
    country: string;
    isEnabled: boolean;
    options: ProtocolOptions;
    encryptedConfig: { version?: number; cipherText: string; salt?: string; iv: string; authTag: string };
  }>,
): Promise<void> => {
  if (items.length === 0) return;

  await queryWrite`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order ASC, created_at DESC) - 1 AS new_rank
      FROM vpn_servers
    )
    UPDATE vpn_servers AS s
    SET sort_order = ranked.new_rank + ${items.length}
    FROM ranked
    WHERE s.id = ranked.id;
  `;

  const BATCH_SIZE = 100;
  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    const chunk = items.slice(index, index + BATCH_SIZE);
    const rows = chunk.map((item, offset) => ({
      id: item.id,
      name: item.name,
      protocol: item.protocol,
      host: item.host,
      port: item.port,
      country: item.country,
      is_enabled: item.isEnabled,
      options_json: JSON.stringify(item.options),
      config_cipher: item.encryptedConfig.cipherText,
      config_salt: item.encryptedConfig.salt ?? null,
      config_iv: item.encryptedConfig.iv,
      config_tag: item.encryptedConfig.authTag,
      config_version: item.encryptedConfig.version ?? 2,
      sort_order: index + offset,
    }));
    await queryWrite`
      INSERT INTO vpn_servers (
        id, name, protocol, host, port, country, is_enabled, options_json,
        config_cipher, config_salt, config_iv, config_tag, config_version, sort_order
      )
      SELECT
        id::uuid,
        name,
        protocol,
        host,
        port,
        country,
        is_enabled,
        options_json,
        config_cipher,
        config_salt,
        config_iv,
        config_tag,
        config_version,
        sort_order
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
        id text,
        name text,
        protocol text,
        host text,
        port int,
        country text,
        is_enabled boolean,
        options_json text,
        config_cipher text,
        config_salt text,
        config_iv text,
        config_tag text,
        config_version int,
        sort_order int
      );
    `;
  }
};

export const replaceServers = async (
  oldIds: string[],
  newItems: Array<{
    id: string;
    name: string;
    protocol: string;
    host: string;
    port: number;
    country: string;
    isEnabled: boolean;
    options: ProtocolOptions;
    encryptedConfig: { version?: number; cipherText: string; salt?: string; iv: string; authTag: string };
  }>,
): Promise<{ inserted: number; deleted: number }> => {
  if (oldIds.length === 0 || newItems.length === 0) {
    return { inserted: 0, deleted: 0 };
  }

  const currentServers = await listServers(false);
  const oldIdSet = new Set(oldIds);
  const remainingNew = [...newItems];

  const totalSelectedInList = currentServers.filter((s) => oldIdSet.has(s.id)).length;
  let selectedEncountered = 0;
  const finalOrderedIds: string[] = [];

  for (const server of currentServers) {
    if (!oldIdSet.has(server.id)) {
      finalOrderedIds.push(server.id);
    } else {
      selectedEncountered++;
      if (selectedEncountered === totalSelectedInList) {
        while (remainingNew.length > 0) {
          const next = remainingNew.shift()!;
          finalOrderedIds.push(next.id);
        }
      } else {
        if (remainingNew.length > 0) {
          const next = remainingNew.shift()!;
          finalOrderedIds.push(next.id);
        }
      }
    }
  }

  while (remainingNew.length > 0) {
    finalOrderedIds.push(remainingNew.shift()!.id);
  }

  const BATCH_SIZE = 100;
  for (let index = 0; index < newItems.length; index += BATCH_SIZE) {
    const chunk = newItems.slice(index, index + BATCH_SIZE);
    const rows = chunk.map((item, offset) => ({
      id: item.id,
      name: item.name,
      protocol: item.protocol,
      host: item.host,
      port: item.port,
      country: item.country,
      is_enabled: item.isEnabled,
      options_json: JSON.stringify(item.options),
      config_cipher: item.encryptedConfig.cipherText,
      config_salt: item.encryptedConfig.salt ?? null,
      config_iv: item.encryptedConfig.iv,
      config_tag: item.encryptedConfig.authTag,
      config_version: item.encryptedConfig.version ?? 2,
      sort_order: 999999 + index + offset,
    }));
    await queryWrite`
      INSERT INTO vpn_servers (
        id, name, protocol, host, port, country, is_enabled, options_json,
        config_cipher, config_salt, config_iv, config_tag, config_version, sort_order
      )
      SELECT
        id::uuid,
        name,
        protocol,
        host,
        port,
        country,
        is_enabled,
        options_json,
        config_cipher,
        config_salt,
        config_iv,
        config_tag,
        config_version,
        sort_order
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
        id text,
        name text,
        protocol text,
        host text,
        port int,
        country text,
        is_enabled boolean,
        options_json text,
        config_cipher text,
        config_salt text,
        config_iv text,
        config_tag text,
        config_version int,
        sort_order int
      );
    `;
  }

  const deleted = await deleteServersByIds(oldIds);

  const orders = finalOrderedIds.map((id, sort_order) => ({ id, sort_order }));
  await updateServerOrders(orders);

  return { inserted: newItems.length, deleted };
};

export const deleteServer = async (id: string): Promise<void> => {
  await queryWrite`DELETE FROM vpn_servers WHERE id = ${id};`;
};

export const deleteAllServers = async (): Promise<number> => {
  const rows = (await queryWrite`DELETE FROM vpn_servers RETURNING id;`) as Array<{ id: string }>;
  return rows.length;
};

export const setAllServersEnabled = async (isEnabled: boolean): Promise<number> => {
  const rows = (await queryWrite`
    UPDATE vpn_servers
    SET is_enabled = ${isEnabled}, updated_at = NOW()
    WHERE is_enabled IS DISTINCT FROM ${isEnabled}
    RETURNING id;
  `) as Array<{ id: string }>;
  return rows.length;
};

export const setServersEnabledByIds = async (ids: string[], isEnabled: boolean): Promise<number> => {
  if (ids.length === 0) return 0;
  const rows = (await queryWrite`
    UPDATE vpn_servers
    SET is_enabled = ${isEnabled}, updated_at = NOW()
    WHERE id = ANY(${ids}::uuid[]) AND is_enabled IS DISTINCT FROM ${isEnabled}
    RETURNING id;
  `) as Array<{ id: string }>;
  return rows.length;
};

export const deleteServersByIds = async (ids: string[]): Promise<number> => {
  if (ids.length === 0) return 0;
  const rows = (await queryWrite`
    DELETE FROM vpn_servers
    WHERE id = ANY(${ids}::uuid[])
    RETURNING id;
  `) as Array<{ id: string }>;
  return rows.length;
};

export const updateServerEnabled = async (id: string, isEnabled: boolean): Promise<void> => {
  await queryWrite`
    UPDATE vpn_servers
    SET is_enabled = ${isEnabled}, updated_at = NOW()
    WHERE id = ${id};
  `;
};

export const getServer = async (id: string): Promise<ServerRecord | null> => {
  const rows = (await queryRead`SELECT * FROM vpn_servers WHERE id = ${id} LIMIT 1;`) as DatabaseServer[];
  if (rows.length === 0) return null;
  return mapServer(rows[0]);
};

export const updateServer = async (
  id: string,
  input: {
    name?: string;
    protocol?: string;
    host?: string;
    port?: number;
    country?: string;
    isEnabled?: boolean;
    options?: ProtocolOptions;
    encryptedConfig?: { version?: number; cipherText: string; salt?: string; iv: string; authTag: string };
  },
): Promise<void> => {
  const hasChanges = Object.values(input).some((value) => value !== undefined);
  if (!hasChanges) return;

  const current = await getServer(id);
  if (!current) throw new Error("Server not found");

  await queryWrite`
    UPDATE vpn_servers SET
      name = ${input.name ?? current.name},
      protocol = ${input.protocol ?? current.protocol},
      host = ${input.host ?? current.host},
      port = ${input.port ?? current.port},
      country = ${input.country ?? current.country},
      is_enabled = ${input.isEnabled ?? current.isEnabled},
      options_json = ${input.options ? JSON.stringify(input.options) : JSON.stringify(current.options)},
      config_cipher = ${input.encryptedConfig?.cipherText ?? current.encryptedConfig.cipherText},
      config_salt = ${input.encryptedConfig?.salt ?? current.encryptedConfig.salt ?? null},
      config_iv = ${input.encryptedConfig?.iv ?? current.encryptedConfig.iv},
      config_tag = ${input.encryptedConfig?.authTag ?? current.encryptedConfig.authTag},
      config_version = ${input.encryptedConfig?.version ?? current.encryptedConfig.version ?? 2},
      updated_at = NOW()
    WHERE id = ${id};
  `;
};

export const renameServers = async (renames: { id: string; name: string }[]): Promise<number> => {
  if (renames.length === 0) return 0;
  await queryWrite`
    WITH incoming AS (
      SELECT id::uuid, name
      FROM jsonb_to_recordset(${JSON.stringify(renames)}::jsonb) AS x(id text, name text)
    )
    UPDATE vpn_servers AS server
    SET name = incoming.name, updated_at = NOW()
    FROM incoming
    WHERE server.id = incoming.id;
  `;
  return renames.length;
};

export const updateServerOrders = async (orders: { id: string; sort_order: number }[]): Promise<void> => {
  if (orders.length === 0) return;
  await queryWrite`
    WITH incoming AS (
      SELECT id::uuid, sort_order
      FROM jsonb_to_recordset(${JSON.stringify(orders)}::jsonb) AS x(id text, sort_order int)
    )
    UPDATE vpn_servers AS server
    SET sort_order = incoming.sort_order, updated_at = NOW()
    FROM incoming
    WHERE server.id = incoming.id;
  `;
};

export type RoutingRuleRecord = {
  id: string;
  type: string;
  value: string;
  created_at: string;
};

export const listRoutingRules = async (): Promise<RoutingRuleRecord[]> => {
  const rows = await queryRead`SELECT id, type, value, created_at FROM routing_rules ORDER BY created_at DESC;`;
  return rows as RoutingRuleRecord[];
};

export const addRoutingRules = async (rules: { id: string; type: string; value: string }[]): Promise<number> => {
  let inserted = 0;
  const BATCH_SIZE = 250;
  for (let i = 0; i < rules.length; i += BATCH_SIZE) {
    const chunk = rules.slice(i, i + BATCH_SIZE);
    const rows = (await queryWrite`
      INSERT INTO routing_rules (id, type, value)
      SELECT id::uuid, type, value
      FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS x(id text, type text, value text)
      ON CONFLICT (type, value) DO NOTHING
      RETURNING id;
    `) as Array<unknown>;
    inserted += rows.length;
  }
  return inserted;
};

export const deleteRoutingRule = async (id: string): Promise<void> => {
  await queryWrite`DELETE FROM routing_rules WHERE id = ${id};`;
};

export const deleteRoutingRules = async (type?: string): Promise<number> => {
  const rows = type
    ? await queryWrite`DELETE FROM routing_rules WHERE type = ${type} RETURNING id;`
    : await queryWrite`DELETE FROM routing_rules RETURNING id;`;
  return (rows as Array<{ id: string }>).length;
};

export const getSetting = async (key: string): Promise<string | null> => {
  const rows = (await queryRead`SELECT value FROM app_settings WHERE key = ${key} LIMIT 1;`) as Array<{ value: string }>;
  if (rows.length === 0) return null;
  return rows[0].value;
};

export const setSetting = async (key: string, value: string): Promise<void> => {
  await queryWrite`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW();
  `;
};

export type L2tpPoolAccount = {
  id: string;
  username: string;
  password: string;
  psk?: string;
};

export const getL2tpSharedPool = async (): Promise<L2tpPoolAccount[]> => {
  const raw = await getSetting("l2tp_shared_pool");
  if (!raw) return [];
  try {
    const encrypted = JSON.parse(raw);
    if (encrypted && encrypted.cipherText) {
      const decrypted = decryptConfig(encrypted);
      const parsed = JSON.parse(decrypted);
      return Array.isArray(parsed) ? parsed : [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const setL2tpSharedPool = async (accounts: L2tpPoolAccount[]): Promise<void> => {
  const jsonStr = JSON.stringify(accounts);
  const encrypted = encryptConfig(jsonStr);
  await setSetting("l2tp_shared_pool", JSON.stringify(encrypted));
};

export type HeartbeatPayload = {
  deviceId: string;
  platform: string;
  appVersion: string;
  osVersion?: string;
  model?: string;
};

export const recordClientHeartbeat = async (payload: HeartbeatPayload): Promise<void> => {
  const deviceId = (payload.deviceId || "").trim().slice(0, 128);
  const platform = (payload.platform || "").trim().toLowerCase().slice(0, 32);
  const appVersion = (payload.appVersion || "unknown").trim().slice(0, 32);
  const osVersion = (payload.osVersion || "").trim().slice(0, 64);
  const model = (payload.model || "").trim().slice(0, 64);

  if (!deviceId || !platform) return;

  const now = Date.now();
  const cached = heartbeatDebounce.get(deviceId);
  if (cached && now - cached.timestamp < 15 * 60 * 1000 && cached.appVersion === appVersion) {
    return;
  }

  heartbeatDebounce.set(deviceId, { timestamp: now, appVersion });

  if (heartbeatDebounce.size > 5000) {
    const cutoff = now - 30 * 60 * 1000;
    for (const [key, entry] of heartbeatDebounce.entries()) {
      if (entry.timestamp < cutoff) heartbeatDebounce.delete(key);
    }
  }

  try {
    await queryWriteNoInvalidate`
      INSERT INTO client_devices (device_id, platform, app_version, os_version, model, first_seen, last_seen)
      VALUES (${deviceId}, ${platform}, ${appVersion}, ${osVersion}, ${model}, NOW(), NOW())
      ON CONFLICT (device_id) DO UPDATE SET
        platform = EXCLUDED.platform,
        app_version = EXCLUDED.app_version,
        os_version = CASE WHEN EXCLUDED.os_version <> '' THEN EXCLUDED.os_version ELSE client_devices.os_version END,
        model = CASE WHEN EXCLUDED.model <> '' THEN EXCLUDED.model ELSE client_devices.model END,
        last_seen = NOW()
      WHERE client_devices.last_seen < NOW() - INTERVAL '15 minutes'
         OR client_devices.app_version <> EXCLUDED.app_version;
    `;
  } catch (err) {
    console.warn("[Heartbeat] Skipped non-critical write:", err instanceof Error ? err.message : String(err));
  }
};

export type PlatformAnalytics = {
  platform: string;
  total: number;
  active24h: number;
  active7d: number;
  active30d: number;
  versions: Record<string, number>;
};

export type DeviceSummary = {
  deviceId: string;
  platform: string;
  appVersion: string;
  osVersion: string;
  model: string;
  firstSeen: string;
  lastSeen: string;
};

export type ClientAnalyticsReport = {
  platforms: Record<string, PlatformAnalytics>;
  totalAll: number;
  active24hAll: number;
  recentDevices: DeviceSummary[];
  updatedAt: string;
};

export const getClientAnalytics = async (): Promise<ClientAnalyticsReport> => {
  const platformRows = (await queryRead`
    SELECT
      platform,
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE last_seen >= NOW() - INTERVAL '24 hours')::int as active_24h,
      COUNT(*) FILTER (WHERE last_seen >= NOW() - INTERVAL '7 days')::int as active_7d,
      COUNT(*) FILTER (WHERE last_seen >= NOW() - INTERVAL '30 days')::int as active_30d
    FROM client_devices
    GROUP BY platform;
  `) as Array<{ platform: string; total: number; active_24h: number; active_7d: number; active_30d: number }>;

  const versionRows = (await queryRead`
    SELECT
      platform,
      app_version,
      COUNT(*)::int as count
    FROM client_devices
    WHERE last_seen >= NOW() - INTERVAL '30 days'
    GROUP BY platform, app_version
    ORDER BY count DESC;
  `) as Array<{ platform: string; app_version: string; count: number }>;

  const platforms: Record<string, PlatformAnalytics> = {};
  let totalAll = 0;
  let active24hAll = 0;

  for (const row of platformRows) {
    totalAll += row.total;
    active24hAll += row.active_24h;
    platforms[row.platform] = {
      platform: row.platform,
      total: row.total,
      active24h: row.active_24h,
      active7d: row.active_7d,
      active30d: row.active_30d,
      versions: {},
    };
  }

  if (!platforms["android"]) {
    platforms["android"] = {
      platform: "android",
      total: 0,
      active24h: 0,
      active7d: 0,
      active30d: 0,
      versions: {},
    };
  }

  for (const v of versionRows) {
    if (platforms[v.platform]) {
      platforms[v.platform].versions[v.app_version] = v.count;
    }
  }

  if (!platforms["windows"]) {
    platforms["windows"] = {
      platform: "windows",
      total: 0,
      active24h: 0,
      active7d: 0,
      active30d: 0,
      versions: {},
    };
  }

  const recentDeviceRows = (await queryRead`
    SELECT
      device_id,
      platform,
      app_version,
      os_version,
      model,
      first_seen,
      last_seen
    FROM client_devices
    ORDER BY last_seen DESC;
  `) as Array<{
    device_id: string;
    platform: string;
    app_version: string;
    os_version: string;
    model: string;
    first_seen: Date | string;
    last_seen: Date | string;
  }>;

  const recentDevices: DeviceSummary[] = recentDeviceRows.map((r) => ({
    deviceId: r.device_id,
    platform: r.platform,
    appVersion: r.app_version,
    osVersion: r.os_version || "",
    model: r.model || "",
    firstSeen: formatIsoDate(r.first_seen),
    lastSeen: formatIsoDate(r.last_seen),
  }));

  return {
    platforms,
    totalAll,
    active24hAll,
    recentDevices,
    updatedAt: new Date().toISOString(),
  };
};

export const deleteClientDevice = async (deviceId: string): Promise<void> => {
  const cleanId = (deviceId || "").trim().slice(0, 128);
  if (!cleanId) return;
  await queryWrite`DELETE FROM client_devices WHERE device_id = ${cleanId}`;
};

export const reconcileServersToNeon = async (): Promise<{ serversCloned: number }> => {
  await ensureSchemaForProvider("supabase");
  await ensureSchemaForProvider("neon");

  // 1. Wipe all existing servers on Neon to guarantee clean clone without stale/orphan servers
  await executeSql("neon")`DELETE FROM vpn_servers;`;

  // 2. Fetch all servers from Supabase
  const supaServers = await executeSql<DatabaseServer>("supabase")`
    SELECT * FROM vpn_servers ORDER BY sort_order ASC, created_at DESC;
  `;

  // 3. Clone all Supabase servers to Neon
  for (const s of supaServers) {
    await executeSql("neon")`
      INSERT INTO vpn_servers (
        id, name, protocol, host, port, country, is_enabled, options_json,
        config_cipher, config_salt, config_iv, config_tag, config_version, sort_order, created_at, updated_at
      ) VALUES (
        ${s.id}, ${s.name}, ${s.protocol}, ${s.host}, ${s.port}, ${s.country}, ${s.is_enabled}, ${s.options_json},
        ${s.config_cipher}, ${s.config_salt}, ${s.config_iv}, ${s.config_tag}, ${s.config_version}, ${s.sort_order}, ${s.created_at}, ${s.updated_at}
      ) ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        protocol = EXCLUDED.protocol,
        host = EXCLUDED.host,
        port = EXCLUDED.port,
        country = EXCLUDED.country,
        is_enabled = EXCLUDED.is_enabled,
        options_json = EXCLUDED.options_json,
        config_cipher = EXCLUDED.config_cipher,
        config_salt = EXCLUDED.config_salt,
        config_iv = EXCLUDED.config_iv,
        config_tag = EXCLUDED.config_tag,
        config_version = EXCLUDED.config_version,
        sort_order = EXCLUDED.sort_order,
        updated_at = EXCLUDED.updated_at;
    `;
  }

  invalidateServerCatalogCache();
  return { serversCloned: supaServers.length };
};

export type DatabaseProviderStatus = {
  provider: DbProvider;
  configured: boolean;
  healthy: boolean;
  serverCount: number | null;
  maxUpdated?: string | null;
  routingRulesCount: number | null;
  error: string | null;
};

export const getDatabaseStatus = async (): Promise<Record<DbProvider, DatabaseProviderStatus>> => {
  const status: Record<DbProvider, DatabaseProviderStatus> = {
    neon: {
      provider: "neon",
      configured: Boolean(getNeonUrl()),
      healthy: isProviderHealthy("neon"),
      serverCount: null,
      maxUpdated: null,
      routingRulesCount: null,
      error: null,
    },
    supabase: {
      provider: "supabase",
      configured: Boolean(getSupabaseUrl()),
      healthy: isProviderHealthy("supabase"),
      serverCount: null,
      maxUpdated: null,
      routingRulesCount: null,
      error: null,
    },
  };

  const checkProvider = async (provider: DbProvider) => {
    if (!status[provider].configured) return;
    if (!isProviderHealthy(provider)) {
      status[provider].healthy = false;
      status[provider].error = "Provider is in cooldown";
      return;
    }
    try {
      const serverRes = (await executeSql<{ count: number; max_updated: string | null }>(provider)`
        SELECT COUNT(*)::int as count, MAX(updated_at)::text as max_updated FROM vpn_servers;
      `) as Array<{ count: number; max_updated: string | null }>;

      const ruleRes = (await executeSql<{ count: number }>(provider)`
        SELECT COUNT(*)::int as count FROM routing_rules;
      `) as Array<{ count: number }>;

      status[provider].serverCount = serverRes[0]?.count ?? 0;
      status[provider].maxUpdated = serverRes[0]?.max_updated ?? null;
      status[provider].routingRulesCount = ruleRes[0]?.count ?? 0;
      status[provider].healthy = true;
    } catch (err) {
      status[provider].healthy = false;
      status[provider].error = err instanceof Error ? err.message : String(err);
    }
  };

  await Promise.allSettled([checkProvider("neon"), checkProvider("supabase")]);

  // Automatic Server Sync / Drift Reconciliation:
  // Supabase is the primary canonical database.
  // If both databases are configured and healthy, and Neon's server count or maxUpdated differs from Supabase:
  // Automatically clone Supabase servers to Neon (wipe Neon, insert all Supabase servers).
  if (
    !autoSyncRunning &&
    status.supabase.configured &&
    status.neon.configured &&
    status.supabase.healthy &&
    status.neon.healthy &&
    status.supabase.serverCount !== null &&
    status.neon.serverCount !== null &&
    (status.neon.serverCount !== status.supabase.serverCount ||
      status.neon.maxUpdated !== status.supabase.maxUpdated)
  ) {
    autoSyncRunning = true;
    reconcileServersToNeon()
      .then((res) => {
        status.neon.serverCount = res.serversCloned;
        status.neon.maxUpdated = status.supabase.maxUpdated;
      })
      .catch((err) => {
        console.warn("[Auto-Sync] Server reconciliation failed:", err);
      })
      .finally(() => {
        autoSyncRunning = false;
      });
  }

  return status;
};

export type SyncEntityOptions = {
  servers?: {
    enabled: boolean;
    direction?: "supabase-to-neon" | "neon-to-supabase" | "two-way";
    strategy?: "overwrite" | "keep-target";
    cleanTarget?: boolean;
  };
  users?: {
    enabled: boolean;
    strategy?: "two-way-merge" | "supabase-to-neon" | "neon-to-supabase";
  };
  routingRules?: {
    enabled: boolean;
    strategy?: "two-way-merge" | "supabase-to-neon" | "neon-to-supabase";
  };
  settings?: {
    enabled: boolean;
    direction?: "supabase-to-neon" | "neon-to-supabase";
  };
};

export type SyncResult = {
  servers: number;
  routingRules: number;
  settings: number;
  devices: number;
  details: string[];
};

export const syncDatabases = async (
  source: DbProvider,
  target: DbProvider,
  options?: SyncEntityOptions,
): Promise<SyncResult> => {
  if (source === target) {
    throw new Error("Source and target databases must be different");
  }

  const details: string[] = [];
  let totalServers = 0;
  let totalRules = 0;
  let totalSettings = 0;
  let totalDevices = 0;

  await ensureSchemaForProvider(source);
  await ensureSchemaForProvider(target);

  // 1. Synchronize Servers
  const syncServersConfig = options?.servers ?? {
    enabled: true,
    direction: source === "supabase" ? "supabase-to-neon" : "neon-to-supabase",
    strategy: "overwrite" as const,
    cleanTarget: source === "supabase" && target === "neon",
  };

  if (syncServersConfig.enabled) {
    const direction = syncServersConfig.direction ?? (source === "supabase" ? "supabase-to-neon" : "neon-to-supabase");
    const strategy = syncServersConfig.strategy ?? "overwrite";
    const cleanTarget = syncServersConfig.cleanTarget ?? (direction === "supabase-to-neon" && strategy === "overwrite");

    const upsertServerToTarget = async (tgt: DbProvider, s: DatabaseServer, strat: "overwrite" | "keep-target") => {
      if (strat === "overwrite") {
        await executeSql(tgt)`
          INSERT INTO vpn_servers (
            id, name, protocol, host, port, country, is_enabled, options_json,
            config_cipher, config_salt, config_iv, config_tag, config_version, sort_order, created_at, updated_at
          ) VALUES (
            ${s.id}, ${s.name}, ${s.protocol}, ${s.host}, ${s.port}, ${s.country}, ${s.is_enabled}, ${s.options_json},
            ${s.config_cipher}, ${s.config_salt}, ${s.config_iv}, ${s.config_tag}, ${s.config_version}, ${s.sort_order}, ${s.created_at}, ${s.updated_at}
          ) ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            protocol = EXCLUDED.protocol,
            host = EXCLUDED.host,
            port = EXCLUDED.port,
            country = EXCLUDED.country,
            is_enabled = EXCLUDED.is_enabled,
            options_json = EXCLUDED.options_json,
            config_cipher = EXCLUDED.config_cipher,
            config_salt = EXCLUDED.config_salt,
            config_iv = EXCLUDED.config_iv,
            config_tag = EXCLUDED.config_tag,
            config_version = EXCLUDED.config_version,
            sort_order = EXCLUDED.sort_order,
            updated_at = EXCLUDED.updated_at;
        `;
      } else {
        await executeSql(tgt)`
          INSERT INTO vpn_servers (
            id, name, protocol, host, port, country, is_enabled, options_json,
            config_cipher, config_salt, config_iv, config_tag, config_version, sort_order, created_at, updated_at
          ) VALUES (
            ${s.id}, ${s.name}, ${s.protocol}, ${s.host}, ${s.port}, ${s.country}, ${s.is_enabled}, ${s.options_json},
            ${s.config_cipher}, ${s.config_salt}, ${s.config_iv}, ${s.config_tag}, ${s.config_version}, ${s.sort_order}, ${s.created_at}, ${s.updated_at}
          ) ON CONFLICT (id) DO NOTHING;
        `;
      }
    };

    if (direction === "two-way") {
      const srcServers = await executeSql<DatabaseServer>("supabase")`
        SELECT * FROM vpn_servers ORDER BY sort_order ASC, created_at DESC;
      `;
      const dstServers = await executeSql<DatabaseServer>("neon")`
        SELECT * FROM vpn_servers ORDER BY sort_order ASC, created_at DESC;
      `;

      for (const s of srcServers) {
        await upsertServerToTarget("neon", s, strategy);
      }
      for (const s of dstServers) {
        await upsertServerToTarget("supabase", s, strategy);
      }
      totalServers = srcServers.length + dstServers.length;
      details.push(`Two-way server sync complete (${srcServers.length} Supabase, ${dstServers.length} Neon).`);
    } else {
      const srcProvider: DbProvider = direction === "supabase-to-neon" ? "supabase" : "neon";
      const dstProvider: DbProvider = direction === "supabase-to-neon" ? "neon" : "supabase";

      if (cleanTarget) {
        await executeSql(dstProvider)`DELETE FROM vpn_servers;`;
        details.push(`Wiped all existing servers on ${dstProvider} before cloning from ${srcProvider}.`);
      }

      const servers = await executeSql<DatabaseServer>(srcProvider)`
        SELECT * FROM vpn_servers ORDER BY sort_order ASC, created_at DESC;
      `;

      for (const s of servers) {
        await upsertServerToTarget(dstProvider, s, strategy);
      }
      totalServers = servers.length;
      details.push(`Synced ${servers.length} server(s) from ${srcProvider} to ${dstProvider} (strategy: ${strategy}${cleanTarget ? ", wiped destination first" : ""}).`);
    }
  }

  // 2. Synchronize Active Users / Client Devices
  const syncUsersConfig = options?.users ?? {
    enabled: true,
    strategy: "two-way-merge" as const,
  };

  if (syncUsersConfig.enabled) {
    const strategy = syncUsersConfig.strategy ?? "two-way-merge";

    type RawDeviceRow = {
      device_id: string;
      platform: string;
      app_version: string;
      os_version: string;
      model: string;
      first_seen: string;
      last_seen: string;
    };

    const upsertDeviceChunk = async (tgt: DbProvider, chunk: RawDeviceRow[]) => {
      await executeSql(tgt)`
        INSERT INTO client_devices (device_id, platform, app_version, os_version, model, first_seen, last_seen)
        SELECT
          device_id,
          platform,
          app_version,
          os_version,
          model,
          first_seen::timestamptz,
          last_seen::timestamptz
        FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS x(
          device_id text,
          platform text,
          app_version text,
          os_version text,
          model text,
          first_seen text,
          last_seen text
        )
        ON CONFLICT (device_id) DO UPDATE SET
          platform = EXCLUDED.platform,
          app_version = EXCLUDED.app_version,
          os_version = CASE WHEN EXCLUDED.os_version <> '' THEN EXCLUDED.os_version ELSE client_devices.os_version END,
          model = CASE WHEN EXCLUDED.model <> '' THEN EXCLUDED.model ELSE client_devices.model END,
          first_seen = LEAST(client_devices.first_seen, EXCLUDED.first_seen),
          last_seen = GREATEST(client_devices.last_seen, EXCLUDED.last_seen);
      `;
    };

    if (strategy === "two-way-merge") {
      const supaDevices = await executeSql<RawDeviceRow>("supabase")`
        SELECT device_id, platform, app_version, os_version, model, first_seen, last_seen FROM client_devices;
      `;
      const neonDevices = await executeSql<RawDeviceRow>("neon")`
        SELECT device_id, platform, app_version, os_version, model, first_seen, last_seen FROM client_devices;
      `;

      const mergedMap = new Map<string, RawDeviceRow>();
      for (const d of [...supaDevices, ...neonDevices]) {
        const existing = mergedMap.get(d.device_id);
        if (!existing) {
          mergedMap.set(d.device_id, { ...d });
        } else {
          const t1 = new Date(existing.first_seen).getTime();
          const t2 = new Date(d.first_seen).getTime();
          const l1 = new Date(existing.last_seen).getTime();
          const l2 = new Date(d.last_seen).getTime();

          existing.first_seen = (isNaN(t1) || t2 < t1) ? d.first_seen : existing.first_seen;
          if (isNaN(l1) || l2 >= l1) {
            existing.last_seen = d.last_seen;
            existing.platform = d.platform || existing.platform;
            existing.app_version = d.app_version || existing.app_version;
            existing.os_version = d.os_version || existing.os_version;
            existing.model = d.model || existing.model;
          }
        }
      }

      const allMerged = Array.from(mergedMap.values());
      const CHUNK = 500;
      for (let i = 0; i < allMerged.length; i += CHUNK) {
        const slice = allMerged.slice(i, i + CHUNK);
        await upsertDeviceChunk("supabase", slice);
        await upsertDeviceChunk("neon", slice);
      }
      totalDevices = allMerged.length;
      details.push(`Two-way merged ${allMerged.length} unique active user devices across Supabase and Neon.`);
    } else {
      const srcProvider: DbProvider = strategy === "supabase-to-neon" ? "supabase" : "neon";
      const dstProvider: DbProvider = strategy === "supabase-to-neon" ? "neon" : "supabase";

      const devices = await executeSql<RawDeviceRow>(srcProvider)`
        SELECT device_id, platform, app_version, os_version, model, first_seen, last_seen FROM client_devices;
      `;

      const CHUNK = 500;
      for (let i = 0; i < devices.length; i += CHUNK) {
        await upsertDeviceChunk(dstProvider, devices.slice(i, i + CHUNK));
      }
      totalDevices = devices.length;
      details.push(`Synced ${devices.length} user devices from ${srcProvider} to ${dstProvider}.`);
    }
  }

  // 3. Synchronize Routing Rules
  const syncRulesConfig = options?.routingRules ?? {
    enabled: true,
    strategy: "two-way-merge" as const,
  };

  if (syncRulesConfig.enabled) {
    const strategy = syncRulesConfig.strategy ?? "two-way-merge";

    const insertRule = async (tgt: DbProvider, r: RoutingRuleRecord) => {
      await executeSql(tgt)`
        INSERT INTO routing_rules (id, type, value, created_at)
        VALUES (${r.id}, ${r.type}, ${r.value}, ${r.created_at})
        ON CONFLICT (type, value) DO NOTHING;
      `;
    };

    if (strategy === "two-way-merge") {
      const supaRules = await executeSql<RoutingRuleRecord>("supabase")`
        SELECT id, type, value, created_at FROM routing_rules;
      `;
      const neonRules = await executeSql<RoutingRuleRecord>("neon")`
        SELECT id, type, value, created_at FROM routing_rules;
      `;

      for (const r of supaRules) await insertRule("neon", r);
      for (const r of neonRules) await insertRule("supabase", r);
      totalRules = supaRules.length + neonRules.length;
      details.push(`Two-way merged routing rules (${supaRules.length} Supabase, ${neonRules.length} Neon).`);
    } else {
      const srcProvider: DbProvider = strategy === "supabase-to-neon" ? "supabase" : "neon";
      const dstProvider: DbProvider = strategy === "supabase-to-neon" ? "neon" : "supabase";

      const rules = await executeSql<RoutingRuleRecord>(srcProvider)`
        SELECT id, type, value, created_at FROM routing_rules;
      `;
      for (const r of rules) await insertRule(dstProvider, r);
      totalRules = rules.length;
      details.push(`Synced ${rules.length} routing rules from ${srcProvider} to ${dstProvider}.`);
    }
  }

  // 4. Synchronize App Settings
  const syncSettingsConfig = options?.settings ?? {
    enabled: true,
    direction: source === "supabase" ? "supabase-to-neon" : "neon-to-supabase",
  };

  if (syncSettingsConfig.enabled) {
    const srcProvider: DbProvider = syncSettingsConfig.direction === "supabase-to-neon" ? "supabase" : "neon";
    const dstProvider: DbProvider = syncSettingsConfig.direction === "supabase-to-neon" ? "neon" : "supabase";

    const settings = await executeSql<{ key: string; value: string }>(srcProvider)`
      SELECT key, value FROM app_settings;
    `;

    for (const st of settings) {
      await executeSql(dstProvider)`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (${st.key}, ${st.value}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
      `;
    }
    totalSettings = settings.length;
    details.push(`Synced ${settings.length} app settings from ${srcProvider} to ${dstProvider}.`);
  }

  invalidateServerCatalogCache();

  return {
    servers: totalServers,
    routingRules: totalRules,
    settings: totalSettings,
    devices: totalDevices,
    details,
  };
};
