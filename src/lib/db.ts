import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import postgres, { type Sql } from "postgres";
import { decryptConfig, encryptConfig } from "@/lib/crypto";
import type { ProtocolOptions, ServerRecord } from "@/types/server";
import { getNeonUrl, getSupabaseUrl } from "@/lib/env";
import { getCountryMeta, getCountryNameFa, normalizeLocationCode } from "@/lib/countries";

export type DbProvider = "neon" | "supabase";

let neonClient: NeonQueryFunction<false, false> | null = null;
let supabaseClient: Sql | null = null;

const cooldownUntil: Record<DbProvider, number> = {
  neon: 0,
  supabase: 0,
};

const schemaReady: Record<DbProvider, boolean> = {
  neon: false,
  supabase: false,
};

let legacyMigrationChecked = false;
let readCounter = 0;
let catalogCacheVersion = 0;

const heartbeatDebounce = new Map<string, { timestamp: number; appVersion: string }>();

export const getCatalogCacheVersion = (): number => catalogCacheVersion;

export const invalidateServerCatalogCache = (): void => {
  catalogCacheVersion += 1;
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
      max: 1,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return supabaseClient;
};

export const getConfiguredProviders = (): DbProvider[] => {
  const providers: DbProvider[] = [];
  if (getNeonUrl()) providers.push("neon");
  if (getSupabaseUrl()) providers.push("supabase");
  return providers;
};

const isProviderHealthy = (provider: DbProvider): boolean =>
  Date.now() >= cooldownUntil[provider];

const markProviderError = (provider: DbProvider, error: unknown): void => {
  const msg = error instanceof Error ? error.message : String(error);
  const isQuota = msg.includes("402") || msg.includes("quota") || msg.includes("exceeded");
  const duration = isQuota ? 300_000 : 60_000;
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

export const ensureSchemaForProvider = async (provider: DbProvider): Promise<void> => {
  if (schemaReady[provider]) return;

  if (provider === "neon") {
    const client = getNeonClient();
    if (!client) throw new Error("Neon DB is not configured");
    const wrapped = Object.assign([DDL_SCRIPT], { raw: [DDL_SCRIPT] }) as unknown as TemplateStringsArray;
    await client(wrapped);
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

const executeOnProvider = async <T = unknown>(
  provider: DbProvider,
  strings: TemplateStringsArray,
  values: unknown[],
): Promise<T[]> => {
  try {
    if (provider === "neon") {
      const client = getNeonClient();
      if (!client) throw new Error("Neon DB is not configured");
      const rows = await client(strings, ...(values as any[]));
      return (rows as unknown as T[]) ?? [];
    }

    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase DB is not configured");
    const rows = await client(strings, ...(values as any[]));
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

export const queryRead = async <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> => {
  const configured = getConfiguredProviders();
  if (configured.length === 0) {
    throw new Error("No database configured (neither Neon nor Supabase URL provided)");
  }

  if (configured.length === 1) {
    const single = configured[0];
    try {
      return await executeOnProvider<T>(single, strings, values);
    } catch (err) {
      markProviderError(single, err);
      throw err;
    }
  }

  const healthy = configured.filter(isProviderHealthy);
  const candidates = healthy.length > 0 ? healthy : configured;

  const primaryIdx = Math.abs(readCounter++) % candidates.length;
  const primary = candidates[primaryIdx];
  const secondary = configured.find((p) => p !== primary);

  try {
    return await executeOnProvider<T>(primary, strings, values);
  } catch (err) {
    markProviderError(primary, err);

    if (secondary) {
      try {
        return await executeOnProvider<T>(secondary, strings, values);
      } catch (secErr) {
        markProviderError(secondary, secErr);
        throw secErr;
      }
    }
    throw err;
  }
};

export const queryWrite = async <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> => {
  const configured = getConfiguredProviders();
  if (configured.length === 0) {
    throw new Error("No database configured (neither Neon nor Supabase URL provided)");
  }

  if (configured.length === 1) {
    const single = configured[0];
    try {
      const res = await executeOnProvider<T>(single, strings, values);
      invalidateServerCatalogCache();
      return res;
    } catch (err) {
      markProviderError(single, err);
      throw err;
    }
  }

  const results = await Promise.allSettled(
    configured.map((p) => executeOnProvider<T>(p, strings, values)),
  );

  let successResult: T[] | null = null;
  const errors: string[] = [];

  results.forEach((res, idx) => {
    const provider = configured[idx];
    if (res.status === "fulfilled") {
      if (!successResult) successResult = res.value;
    } else {
      markProviderError(provider, res.reason);
      errors.push(`${provider}: ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`);
    }
  });

  if (successResult !== null) {
    invalidateServerCatalogCache();
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
  created_at: string;
  updated_at: string;
};

const mapServer = (row: DatabaseServer): ServerRecord => ({
  id: row.id,
  name: row.name,
  protocol: row.protocol,
  host: row.host,
  port: row.port,
  country: row.country,
  isEnabled: row.is_enabled,
  options: JSON.parse(row.options_json) as ProtocolOptions,
  encryptedConfig: {
    version: row.config_version ?? undefined,
    cipherText: row.config_cipher,
    salt: row.config_salt ?? undefined,
    iv: row.config_iv,
    authTag: row.config_tag,
  },
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

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
    await queryWrite`
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
    firstSeen: new Date(r.first_seen).toISOString(),
    lastSeen: new Date(r.last_seen).toISOString(),
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

export type DatabaseProviderStatus = {
  provider: DbProvider;
  configured: boolean;
  healthy: boolean;
  serverCount: number | null;
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
      routingRulesCount: null,
      error: null,
    },
    supabase: {
      provider: "supabase",
      configured: Boolean(getSupabaseUrl()),
      healthy: isProviderHealthy("supabase"),
      serverCount: null,
      routingRulesCount: null,
      error: null,
    },
  };

  const checkProvider = async (provider: DbProvider) => {
    if (!status[provider].configured) return;
    try {
      const serverRes = (await executeOnProvider<{ count: number }>(
        provider,
        Object.assign([`SELECT COUNT(*)::int as count FROM vpn_servers`], {
          raw: [`SELECT COUNT(*)::int as count FROM vpn_servers`],
        }) as unknown as TemplateStringsArray,
        [],
      )) as Array<{ count: number }>;

      const ruleRes = (await executeOnProvider<{ count: number }>(
        provider,
        Object.assign([`SELECT COUNT(*)::int as count FROM routing_rules`], {
          raw: [`SELECT COUNT(*)::int as count FROM routing_rules`],
        }) as unknown as TemplateStringsArray,
        [],
      )) as Array<{ count: number }>;

      status[provider].serverCount = serverRes[0]?.count ?? 0;
      status[provider].routingRulesCount = ruleRes[0]?.count ?? 0;
      status[provider].healthy = true;
    } catch (err) {
      status[provider].healthy = false;
      status[provider].error = err instanceof Error ? err.message : String(err);
    }
  };

  await Promise.allSettled([checkProvider("neon"), checkProvider("supabase")]);
  return status;
};

export const syncDatabases = async (
  source: DbProvider,
  target: DbProvider,
): Promise<{ servers: number; routingRules: number; settings: number }> => {
  if (source === target) {
    throw new Error("Source and target databases must be different");
  }

  await ensureSchemaForProvider(target);

  const servers = (await executeOnProvider<DatabaseServer>(
    source,
    Object.assign([`SELECT * FROM vpn_servers ORDER BY sort_order ASC, created_at DESC`], {
      raw: [`SELECT * FROM vpn_servers ORDER BY sort_order ASC, created_at DESC`],
    }) as unknown as TemplateStringsArray,
    [],
  )) as DatabaseServer[];

  for (const s of servers) {
    await executeOnProvider(
      target,
      Object.assign(
        [
          `INSERT INTO vpn_servers (
            id, name, protocol, host, port, country, is_enabled, options_json,
            config_cipher, config_salt, config_iv, config_tag, config_version, sort_order, created_at, updated_at
          ) VALUES (
            `,
          `, `,
          `, `,
          `, `,
          `, `,
          `, `,
          `, `,
          `, `,
          `, `,
          `, `,
          `, `,
          `, `,
          `, `,
          `, `,
          `, `,
          `
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
            updated_at = EXCLUDED.updated_at;`,
        ],
        {
          raw: [
            `INSERT INTO vpn_servers (
            id, name, protocol, host, port, country, is_enabled, options_json,
            config_cipher, config_salt, config_iv, config_tag, config_version, sort_order, created_at, updated_at
          ) VALUES (
            `,
            `, `,
            `, `,
            `, `,
            `, `,
            `, `,
            `, `,
            `, `,
            `, `,
            `, `,
            `, `,
            `, `,
            `, `,
            `, `,
            `, `,
            `
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
            updated_at = EXCLUDED.updated_at;`,
          ],
        },
      ) as unknown as TemplateStringsArray,
      [
        s.id,
        s.name,
        s.protocol,
        s.host,
        s.port,
        s.country,
        s.is_enabled,
        s.options_json,
        s.config_cipher,
        s.config_salt,
        s.config_iv,
        s.config_tag,
        s.config_version,
        s.sort_order,
        s.created_at,
        s.updated_at,
      ],
    );
  }

  const rules = (await executeOnProvider<RoutingRuleRecord>(
    source,
    Object.assign([`SELECT id, type, value, created_at FROM routing_rules`], {
      raw: [`SELECT id, type, value, created_at FROM routing_rules`],
    }) as unknown as TemplateStringsArray,
    [],
  )) as RoutingRuleRecord[];

  for (const r of rules) {
    await executeOnProvider(
      target,
      Object.assign(
        [
          `INSERT INTO routing_rules (id, type, value, created_at)
           VALUES (`,
          `, `,
          `, `,
          `, `,
          `) ON CONFLICT (type, value) DO NOTHING;`,
        ],
        {
          raw: [
            `INSERT INTO routing_rules (id, type, value, created_at)
           VALUES (`,
            `, `,
            `, `,
            `, `,
            `) ON CONFLICT (type, value) DO NOTHING;`,
          ],
        },
      ) as unknown as TemplateStringsArray,
      [r.id, r.type, r.value, r.created_at],
    );
  }

  const settings = (await executeOnProvider<{ key: string; value: string }>(
    source,
    Object.assign([`SELECT key, value FROM app_settings`], {
      raw: [`SELECT key, value FROM app_settings`],
    }) as unknown as TemplateStringsArray,
    [],
  )) as Array<{ key: string; value: string }>;

  for (const st of settings) {
    await executeOnProvider(
      target,
      Object.assign(
        [
          `INSERT INTO app_settings (key, value, updated_at)
           VALUES (`,
          `, `,
          `, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
        ],
        {
          raw: [
            `INSERT INTO app_settings (key, value, updated_at)
           VALUES (`,
            `, `,
            `, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
          ],
        },
      ) as unknown as TemplateStringsArray,
      [st.key, st.value],
    );
  }

  invalidateServerCatalogCache();

  return {
    servers: servers.length,
    routingRules: rules.length,
    settings: settings.length,
  };
};
