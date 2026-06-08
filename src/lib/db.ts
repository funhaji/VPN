import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { decryptConfig, encryptConfig } from "@/lib/crypto";
import type { ProtocolOptions, ServerRecord } from "@/types/server";
import { getDatabaseUrl } from "@/lib/env";

let schemaReady = false;
let legacyMigrationChecked = false;
let sql: NeonQueryFunction<false, false> | null = null;

const getSql = (): NeonQueryFunction<false, false> => {
  if (!sql) {
    sql = neon(getDatabaseUrl());
  }
  return sql;
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

export const ensureSchema = async (): Promise<void> => {
  if (schemaReady) {
    return;
  }
  const query = getSql();
  await query`
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
  `;
  await query`
    ALTER TABLE vpn_servers
    ADD COLUMN IF NOT EXISTS config_salt TEXT;
  `;
  await query`
    ALTER TABLE vpn_servers
    ADD COLUMN IF NOT EXISTS config_version INT NOT NULL DEFAULT 1;
  `;
  await query`
    ALTER TABLE vpn_servers
    ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
  `;
  await query`
    CREATE INDEX IF NOT EXISTS idx_vpn_servers_enabled ON vpn_servers(is_enabled);
  `;
  await query`
    CREATE TABLE IF NOT EXISTS routing_rules (
      id UUID PRIMARY KEY,
      type VARCHAR(20) NOT NULL,
      value TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await query`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_routing_rules_type_value ON routing_rules(type, value);
  `;
  schemaReady = true;
};

const migrateLegacyEncryption = async (): Promise<void> => {
  if (legacyMigrationChecked) {
    return;
  }

  await ensureSchema();
  const query = getSql();
  const rows = (await query`
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
      await query`
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
    } catch {
      // Leave broken rows untouched; the public API skips them instead of failing entirely.
    }
  }

  legacyMigrationChecked = true;
};

export const migrateServerEncryption = async (): Promise<{ migrated: number; failed: number }> => {
  await ensureSchema();
  const query = getSql();
  const rows = (await query`
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
      await query`
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
  await ensureSchema();
  await migrateLegacyEncryption();
  const query = getSql();
  const rows = (enabledOnly
    ? await query`
      SELECT * FROM vpn_servers WHERE is_enabled = TRUE ORDER BY sort_order ASC, updated_at DESC
    `
    : await query`
      SELECT * FROM vpn_servers ORDER BY sort_order ASC, updated_at DESC
    `) as DatabaseServer[];
  return rows.map((row) => mapServer(row));
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
  await ensureSchema();
  const query = getSql();
  await query`
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
  const BATCH_SIZE = 20;
  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    const chunk = items.slice(index, index + BATCH_SIZE);
    await Promise.all(chunk.map((item) => createServer(item)));
  }
};

export const deleteServer = async (id: string): Promise<void> => {
  await ensureSchema();
  const query = getSql();
  await query`DELETE FROM vpn_servers WHERE id = ${id};`;
};

export const updateServerEnabled = async (id: string, isEnabled: boolean): Promise<void> => {
  await ensureSchema();
  const query = getSql();
  await query`
    UPDATE vpn_servers
    SET is_enabled = ${isEnabled}, updated_at = NOW()
    WHERE id = ${id};
  `;
};

export const getServer = async (id: string): Promise<ServerRecord | null> => {
  await ensureSchema();
  const query = getSql();
  const rows = await query`SELECT * FROM vpn_servers WHERE id = ${id} LIMIT 1;` as DatabaseServer[];
  if (rows.length === 0) return null;
  return mapServer(rows[0]);
};

export const updateServer = async (id: string, input: {
  name?: string;
  protocol?: string;
  host?: string;
  port?: number;
  country?: string;
  isEnabled?: boolean;
  options?: ProtocolOptions;
  encryptedConfig?: { version?: number; cipherText: string; salt?: string; iv: string; authTag: string };
}): Promise<void> => {
  await ensureSchema();
  const query = getSql();
  
  const updates: string[] = [];
  const values: any[] = [];
  
  const addUpdate = (column: string, value: any) => {
    updates.push(`${column} = $${values.length + 1}`);
    values.push(value);
  };
  
  if (input.name !== undefined) addUpdate('name', input.name);
  if (input.protocol !== undefined) addUpdate('protocol', input.protocol);
  if (input.host !== undefined) addUpdate('host', input.host);
  if (input.port !== undefined) addUpdate('port', input.port);
  if (input.country !== undefined) addUpdate('country', input.country);
  if (input.isEnabled !== undefined) addUpdate('is_enabled', input.isEnabled);
  if (input.options !== undefined) addUpdate('options_json', JSON.stringify(input.options));
  if (input.encryptedConfig !== undefined) {
    addUpdate('config_cipher', input.encryptedConfig.cipherText);
    addUpdate('config_salt', input.encryptedConfig.salt ?? null);
    addUpdate('config_iv', input.encryptedConfig.iv);
    addUpdate('config_tag', input.encryptedConfig.authTag);
    addUpdate('config_version', input.encryptedConfig.version ?? 2);
  }
  
  if (updates.length === 0) return;
  
  addUpdate('updated_at', new Date());
  
  values.push(id);
  const sqlString = `UPDATE vpn_servers SET ${updates.join(', ')} WHERE id = $${values.length};`;
  
  // Dynamic query using raw string since neon query builder doesn't easily support dynamic SET blocks
  // but wait, neon query template literal is required to avoid injection. 
  // We can just construct a safe query or update everything.
  // A safer approach with neon template literal:
  
  const current = await getServer(id);
  if (!current) throw new Error("Server not found");
  
  await query`
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
  await ensureSchema();
  const query = getSql();
  // Using a transaction is better, but since serverless neon doesn't guarantee transaction support easily without explicit connection blocks, 
  // we can update one by one for small lists or use a CTE/unnest. Let's do batch sequential.
  for (const item of orders) {
    await query`
      UPDATE vpn_servers SET sort_order = ${item.sort_order}, updated_at = NOW() WHERE id = ${item.id};
    `;
  }
  }
};

export type RoutingRuleRecord = {
  id: string;
  type: string;
  value: string;
  created_at: string;
};

export const listRoutingRules = async (): Promise<RoutingRuleRecord[]> => {
  await ensureSchema();
  const query = getSql();
  const rows = await query`SELECT id, type, value, created_at FROM routing_rules ORDER BY created_at DESC;`;
  return rows as RoutingRuleRecord[];
};

export const addRoutingRules = async (rules: { id: string; type: string; value: string }[]): Promise<void> => {
  await ensureSchema();
  const query = getSql();
  const BATCH_SIZE = 50;
  for (let i = 0; i < rules.length; i += BATCH_SIZE) {
    const chunk = rules.slice(i, i + BATCH_SIZE);
    await Promise.all(chunk.map(r => query`
      INSERT INTO routing_rules (id, type, value)
      VALUES (${r.id}, ${r.type}, ${r.value})
      ON CONFLICT (type, value) DO NOTHING;
    `));
  }
};

export const deleteRoutingRule = async (id: string): Promise<void> => {
  await ensureSchema();
  const query = getSql();
  await query`DELETE FROM routing_rules WHERE id = ${id};`;
};
