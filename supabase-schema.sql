-- Astro VPN - Supabase PostgreSQL Schema
-- Run this in your Supabase SQL Editor if you want to initialize tables manually.
-- (The Astro VPN server will also auto-create these if not present).

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
