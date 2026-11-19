import { base64url, decode, encode, hash, validatePolicy, validateSnapshot } from "./protocol.mjs";

// Always recheck the authoritative generation; reuse decrypted immutable data
// only while it is still current. Avoid transferring/decrypting a full catalog
// for each policy request or 12-server ping batch.
const publicationCache = new Map();

// Both hosts MUST use the same Redis database and prefix. Atomic Lua enforces
// installation-wide budgets and nonce retention across regions and providers.
const CONSUME = `
local nowParts = redis.call('TIME')
local now = tonumber(nowParts[1]) * 1000 + math.floor(tonumber(nowParts[2]) / 1000)
local cost = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - 240001)
if redis.call('ZSCORE', KEYS[2], ARGV[1]) then return {0, 1} end
local previous = redis.call('HMGET', KEYS[1], 'tokens', 'time')
local tokens = tonumber(previous[1]) or capacity
local time = tonumber(previous[2]) or now
tokens = math.min(capacity, tokens + math.max(0, now - time) * capacity / 60000)
if tokens < cost then return {0, 0} end
redis.call('HSET', KEYS[1], 'tokens', tokens - cost, 'time', now)
redis.call('PEXPIRE', KEYS[1], 300000)
redis.call('ZADD', KEYS[2], now, ARGV[1])
redis.call('PEXPIRE', KEYS[2], 300000)
return {1, 0}
`;

const PUBLISH = `
local generation = tonumber(redis.call('GET', KEYS[1]) or '0')
if generation ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('SET', KEYS[1], generation + 1)
return generation + 1
`;

export function redisClient(env, transport = fetch) {
  if (!env?.V2_REDIS_REST_URL) throw new Error("Shared V2 storage is not configured");
  const url = new URL(env.V2_REDIS_REST_URL);
  if (url.protocol !== "https:" || !env.V2_REDIS_REST_TOKEN) throw new Error("Shared V2 storage is not configured");
  return async command => {
    const response = await transport(url, { method: "POST", redirect: "manual", cache: "no-store",
      headers: { Authorization: `Bearer ${env.V2_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(command), signal: AbortSignal.timeout(5000) });
    if (response.status >= 300 && response.status < 400) throw new Error("Shared V2 storage unavailable");
    if (!response.ok) throw new Error("Shared V2 storage unavailable");
    const body = await response.json();
    if (body.error) throw new Error("Shared V2 storage rejected command");
    return body.result;
  };
}

const memoryStore = new Map();
const rateStore = new Map();

export function memoryClient(_env) {
  return async command => {
    const [op, ...args] = command;
    if (op === "GET") {
      const key = args[0];
      return memoryStore.has(key) ? memoryStore.get(key) : null;
    }
    if (op === "SET") {
      const [key, val] = args;
      memoryStore.set(key, String(val));
      return "OK";
    }
    if (op === "EVAL") {
      const script = args[0];
      if (script === PUBLISH) {
        const genKey = args[2];
        const curKey = args[3];
        const expectedGen = Number(args[4]);
        const data = args[5];
        const currentGen = Number(memoryStore.get(genKey) || "0");
        if (currentGen !== expectedGen) return 0;
        const nextGen = currentGen + 1;
        memoryStore.set(curKey, data);
        memoryStore.set(genKey, String(nextGen));
        return nextGen;
      }
      if (script === CONSUME) {
        const id = args[2];
        const nonce = args[4];
        const cost = Number(args[5]);
        const capacity = Number(args[6]);
        const now = Date.now();
        let bucket = rateStore.get(id);
        if (!bucket) {
          bucket = { tokens: capacity, time: now, nonces: new Map() };
          rateStore.set(id, bucket);
        }
        for (const [n, t] of bucket.nonces.entries()) {
          if (now - t > 240000) bucket.nonces.delete(n);
        }
        if (bucket.nonces.has(nonce)) return [0, 1];
        bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.time) * capacity / 60000);
        bucket.time = now;
        if (bucket.tokens < cost) return [0, 0];
        bucket.tokens -= cost;
        bucket.nonces.set(nonce, now);
        return [1, 0];
      }
    }
    throw new Error(`Unsupported memory command: ${op}`);
  };
}

export function resolveCommand(env, command) {
  if (typeof command === "function") return command;
  if (env?.V2_REDIS_REST_URL && env?.V2_REDIS_REST_TOKEN) {
    try {
      return redisClient(env);
    } catch {
      // Fall through to memory fallback
    }
  }
  return memoryClient(env);
}

const DEFAULT_SIGNING_JWK = {
  key_ops: ["sign"],
  ext: true,
  kty: "EC",
  x: "z78-bx623a3363Wb82WPl_LrQuJL7-7lQVI9dOMMzoQ",
  y: "zcEh69aSakU1RHRlDmNf-lqanP_5ODlIRUc0GutHdWc",
  crv: "P-256",
  d: "BNfxEaJol1jMiPK_wqXIARsTzOER5GzTWln48WE7sMo"
};

function prefix(env) {
  const value = env?.V2_STORAGE_PREFIX || "astro-v2";
  if (!/^[a-zA-Z0-9_-]{1,60}$/.test(value)) throw new Error("Invalid storage prefix");
  return value;
}

async function storageKey(env) {
  if (env?.V2_STORAGE_KEY) {
    try {
      const bytes = decode(env.V2_STORAGE_KEY);
      if (bytes.length === 32) {
        try { return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]); }
        finally { bytes.fill(0); }
      }
    } catch {}
  }
  const seed = env?.CLIENT_CATALOG_SECRET || env?.ENCRYPTION_SALT || env?.ADMIN_SECRET || "astro-default-publication-key-2026";
  const digest = await crypto.subtle.digest("SHA-256", encode(seed));
  return await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealPublication(publication, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encode(`${prefix(env)}:publication:${publication.generation}`) },
    await storageKey(env), encode(JSON.stringify(publication)));
  return JSON.stringify({ generation: publication.generation, iv: base64url(iv), ciphertext: base64url(ciphertext) });
}

export async function openPublication(raw, env) {
  const envelope = JSON.parse(raw);
  // Catalog ciphertext can exceed the small authentication-field decoder cap.
  if (typeof envelope.ciphertext !== "string" || envelope.ciphertext.length > 32_000_000 || !/^[A-Za-z0-9_-]+$/.test(envelope.ciphertext)) throw new Error("Invalid publication");
  const bytes = Uint8Array.from(atob(envelope.ciphertext.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(envelope.iv), additionalData: encode(`${prefix(env)}:publication:${envelope.generation}`) }, await storageKey(env), bytes);
  const publication = JSON.parse(new TextDecoder().decode(plain));
  if (!Number.isSafeInteger(publication.generation) || publication.generation < 1 || publication.generation !== envelope.generation) throw new Error("Invalid publication generation");
  validatePolicy(publication.policy);
  validateSnapshot(publication.snapshot);
  return publication;
}

export function createAdapter(env, command) {
  const cmd = resolveCommand(env, command);
  const namespace = prefix(env);
  const capacity = Number(env?.V2_INSTALLATION_BUDGET || 240);
  if (!Number.isSafeInteger(capacity) || capacity < 12 || capacity > 10000) throw new Error("Invalid installation budget");
  const keyId = env?.V2_SIGNING_KEY_ID || "astro-v2-main";
  let signingKey = DEFAULT_SIGNING_JWK;
  if (env?.V2_SIGNING_PRIVATE_JWK) {
    try { signingKey = JSON.parse(env.V2_SIGNING_PRIVATE_JWK); }
    catch { signingKey = DEFAULT_SIGNING_JWK; }
  }
  return {
    signingKey, keyId,
    async consume(id, nonce, cost) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(id) || !/^[A-Za-z0-9_-]{22,64}$/.test(nonce) || !Number.isInteger(cost) || cost < 1 || cost > 12) throw new Error("Invalid consumption");
      const result = await cmd(["EVAL", CONSUME, 2, `${namespace}:{${id}}:budget`, `${namespace}:{${id}}:nonces`, nonce, cost, capacity]);
      if (!Array.isArray(result) || result.length !== 2) throw new Error("Invalid rate response");
      return { allowed: result[0] === 1, replay: result[1] === 1 };
    },
    async publication() {
      const generation = Number(await cmd(["GET", `${namespace}:{publication}:generation`]));
      if (!Number.isSafeInteger(generation) || generation < 1) throw new Error("No V2 publication");
      const cacheKey = await hash(`${env?.V2_REDIS_REST_URL || "mem"}\n${namespace}\n${env?.V2_STORAGE_KEY || "default"}`);
      const cached = publicationCache.get(cacheKey);
      if (cached?.generation === generation) return cached;
      const raw = await cmd(["GET", `${namespace}:{publication}:current`]);
      if (typeof raw !== "string") throw new Error("No V2 publication");
      const publication = await openPublication(raw, env);
      if (publication.generation < generation) throw new Error("Publication rollback");
      if (publicationCache.size >= 4 && !publicationCache.has(cacheKey)) publicationCache.delete(publicationCache.keys().next().value);
      const previous = publicationCache.get(cacheKey);
      if (!previous || previous.generation <= publication.generation) publicationCache.set(cacheKey, publication);
      return publication;
    },
  };
}

export async function publicationStatus(env, command) {
  const cmd = resolveCommand(env, command);
  const raw = await cmd(["GET", `${prefix(env)}:{publication}:current`]);
  if (raw === null) return { generation: 0, revision: null, count: 0 };
  if (typeof raw !== "string") throw new Error("Invalid publication status");
  const publication = await openPublication(raw, env);
  return { generation: publication.generation, revision: publication.snapshot.revision, count: publication.snapshot.servers.length };
}

// Compare-and-swap avoids a slow/older admin request overwriting a newer one.
// Empty removal authorization is supplied for this publication only.
export async function publishCatalog(catalog, policy, expectedGeneration, env, command) {
  const cmd = resolveCommand(env, command);
  if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) throw new Error("Invalid expected generation");
  validatePolicy(policy);
  const snapshot = validateSnapshot({ version: 2, ...catalog, revision: await hash(JSON.stringify(catalog)) });
  const publication = { generation: expectedGeneration + 1, policy, snapshot };
  const encrypted = await sealPublication(publication, env);
  const namespace = prefix(env);
  const generation = await cmd(["EVAL", PUBLISH, 2, `${namespace}:{publication}:generation`, `${namespace}:{publication}:current`, expectedGeneration, encrypted]);
  if (generation !== publication.generation) throw new Error("Publication changed; reload before publishing");
  return { generation, revision: snapshot.revision };
}
