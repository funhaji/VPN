import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { ProtocolOptions, ServerRecord } from "@/types/server";
import { decryptConfig, encryptConfig, needsConfigReencryption } from "@/lib/crypto";
import { getDatabaseUrl } from "@/lib/env";

let schemaReady = false;
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
  config_iv: string;
  config_tag: string;
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
    cipherText: row.config_cipher,
    iv: row.config_iv,
    authTag: row.config_tag,
  },
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
      config_iv TEXT NOT NULL,
      config_tag TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await query`
    CREATE INDEX IF NOT EXISTS idx_vpn_servers_enabled ON vpn_servers(is_enabled);
  `;
  schemaReady = true;
};

export const migrateServerEncryption = async (): Promise<{ migrated: number; failed: number }> => {
  await ensureSchema();
  const query = getSql();
  const rows = (await query`SELECT * FROM vpn_servers`) as DatabaseServer[];
  let migrated = 0;
  let failed = 0;

  for (const row of rows) {
    const encryptedConfig = {
      cipherText: row.config_cipher,
      iv: row.config_iv,
      authTag: row.config_tag,
    };
    if (!needsConfigReencryption(encryptedConfig)) {
      continue;
    }
    try {
      const plainText = decryptConfig(encryptedConfig);
      const upgraded = encryptConfig(plainText);
      await query`
        UPDATE vpn_servers
        SET
          config_cipher = ${upgraded.cipherText},
          config_iv = ${upgraded.iv},
          config_tag = ${upgraded.authTag},
          updated_at = NOW()
        WHERE id = ${row.id};
      `;
      migrated += 1;
    } catch {
      failed += 1;
    }
  }

  return { migrated, failed };
};

let storageMigrationStarted = false;

const kickoffStorageMigration = (): void => {
  if (storageMigrationStarted) {
    return;
  }
  storageMigrationStarted = true;
  void migrateServerEncryption().catch(() => undefined);
};

export const listServers = async (enabledOnly: boolean): Promise<ServerRecord[]> => {
  await ensureSchema();
  kickoffStorageMigration();
  const query = getSql();
  const rows = (enabledOnly
    ? await query`
      SELECT * FROM vpn_servers WHERE is_enabled = TRUE ORDER BY updated_at DESC
    `
    : await query`
      SELECT * FROM vpn_servers ORDER BY updated_at DESC
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
  encryptedConfig: { cipherText: string; iv: string; authTag: string };
}): Promise<void> => {
  await ensureSchema();
  const query = getSql();
  await query`
    INSERT INTO vpn_servers (
      id, name, protocol, host, port, country, is_enabled, options_json, config_cipher, config_iv, config_tag
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
      ${input.encryptedConfig.iv},
      ${input.encryptedConfig.authTag}
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
    encryptedConfig: { cipherText: string; iv: string; authTag: string };
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
