const readEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const readEnvOptional = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
};

export const getDatabaseUrl = (): string =>
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  readEnv("DATABASE_URL");

export const getPassphrase = (): string => readEnv("PASS");

export const getClientCatalogToken = (): string =>
  readEnvOptional("CLIENT_CATALOG_TOKEN") ??
  readEnvOptional("ASTRO_VPN_CLIENT_TOKEN") ??
  readEnv("CLIENT_CATALOG_TOKEN");
