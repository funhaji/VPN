const isSupabaseHost = (url: string): boolean =>
  url.includes("supabase.co") || url.includes("pooler.supabase.com");

export const getSupabaseUrl = (): string | null => {
  const explicit =
    process.env.SUPABASE_DATABASE_URL ??
    process.env.SUPABASE_POSTGRES_URL ??
    process.env.SUPABASE_URL_POOLED ??
    process.env.SUPABASE_URL;
  if (explicit && explicit.trim()) {
    return explicit.trim();
  }

  const generic =
    process.env.DATABASE_URL_POOLED ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.DATABASE_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING;

  if (generic && isSupabaseHost(generic)) {
    return generic.trim();
  }

  return null;
};

export const getNeonUrl = (): string | null => {
  const explicit =
    process.env.NEON_DATABASE_URL ??
    process.env.NEON_POSTGRES_URL ??
    process.env.NEON_URL;
  if (explicit && explicit.trim()) {
    return explicit.trim();
  }

  const generic =
    process.env.DATABASE_URL_POOLED ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.DATABASE_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING;

  if (generic && !isSupabaseHost(generic)) {
    return generic.trim();
  }

  return null;
};

export const getDatabaseUrl = (): string => {
  const neon = getNeonUrl();
  if (neon) return neon;
  const supabase = getSupabaseUrl();
  if (supabase) return supabase;
  throw new Error("Missing required database configuration: set NEON_DATABASE_URL or SUPABASE_DATABASE_URL");
};

export const getPassphrase = (): string => {
  const value = process.env.PASS;
  if (!value) {
    throw new Error("Missing required environment variable: PASS");
  }
  return value;
};

export const getClientCatalogSecret = (): string =>
  process.env.CLIENT_CATALOG_SECRET ?? process.env.PASS ?? getPassphrase();
