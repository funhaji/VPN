const readEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const getDatabaseUrl = (): string =>
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  readEnv("DATABASE_URL");

export const getPassphrase = (): string => readEnv("PASS");

/** Shared secret for Fernet-encrypted client catalog payloads (wire transport). */
export const getClientCatalogSecret = (): string =>
  process.env.CLIENT_CATALOG_SECRET ?? process.env.PASS ?? readEnv("PASS");
