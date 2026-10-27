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

const sanitizeSecret = (val: string | undefined): string | null => {
  if (!val) return null;
  const trimmed = val.trim().replace(/^["']|["']$/g, "").trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const getPassphrase = (): string => {
  const explicit = sanitizeSecret(process.env.PASS);
  if (explicit) return explicit;
  const catalogSecret = sanitizeSecret(process.env.CLIENT_CATALOG_SECRET);
  if (catalogSecret) return catalogSecret;
  return "1234Taha!";
};

export const getPassphraseCandidates = (): string[] => {
  const set = new Set<string>();

  const add = (raw: string | undefined | null) => {
    const s = sanitizeSecret(raw ?? undefined);
    if (s) set.add(s);
  };

  add(getPassphrase());
  add(process.env.PASS);
  add(process.env.CLIENT_CATALOG_SECRET);
  add("1234Taha!");
  add("13801234Taha!");

  const supa = process.env.SUPABASE_DATABASE_URL ?? process.env.SUPABASE_POSTGRES_URL;
  if (supa) {
    try {
      const parsed = new URL(supa);
      if (parsed.password) add(decodeURIComponent(parsed.password));
    } catch {}
  }

  const generic = process.env.DATABASE_URL_POOLED ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
  if (generic) {
    try {
      const parsed = new URL(generic);
      if (parsed.password) add(decodeURIComponent(parsed.password));
    } catch {}
  }

  return Array.from(set);
};

export const getDeploymentSalt = (): string =>
  sanitizeSecret(process.env.ENCRYPTION_SALT) ?? "AUGabgabgoag";

export const getDeploymentSaltCandidates = (): string[] => {
  const set = new Set<string>();
  const explicit = sanitizeSecret(process.env.ENCRYPTION_SALT);
  if (explicit) set.add(explicit);
  set.add("AUGabgabgoag");
  return Array.from(set);
};

export const getClientCatalogSecret = (): string =>
  sanitizeSecret(process.env.CLIENT_CATALOG_SECRET) ?? getPassphrase();
