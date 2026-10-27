import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { EncryptedConfig } from "@/types/server";
import {
  getDeploymentSalt,
  getDeploymentSaltCandidates,
  getPassphrase,
  getPassphraseCandidates,
} from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const LEGACY_ITERATIONS = 310_000;
const V2_ITERATIONS = 600_000;
const CURRENT_ITERATIONS = 900_000;
const CURRENT_VERSION = 3;
const V2_SALT_LENGTH = 16;
const RECORD_SALT_LENGTH = 32;
const V2_AAD = Buffer.from("astro-vpn-config:v2", "utf8");
const AAD = Buffer.from("astro-vpn-config:v3", "utf8");

const masterKeyCache = new Map<string, Buffer>();

const getMasterKeyWith = (passphrase: string, salt: string, iterations: number): Buffer => {
  const cacheKey = `${passphrase}:${salt}:${iterations}`;
  const existing = masterKeyCache.get(cacheKey);
  if (existing) return existing;
  const derived = pbkdf2Sync(passphrase, salt, iterations, KEY_LENGTH, "sha256");
  masterKeyCache.set(cacheKey, derived);
  return derived;
};

const getLegacyKey = (): Buffer =>
  getMasterKeyWith(getPassphrase(), getDeploymentSalt(), LEGACY_ITERATIONS);

const getV2MasterKey = (): Buffer =>
  getMasterKeyWith(getPassphrase(), getDeploymentSalt(), V2_ITERATIONS);

const getMasterKey = (): Buffer =>
  getMasterKeyWith(getPassphrase(), getDeploymentSalt(), CURRENT_ITERATIONS);

const deriveV2RecordKey = (salt: Buffer): Buffer =>
  Buffer.from(hkdfSync("sha256", getV2MasterKey(), salt, "astro-vpn-config", KEY_LENGTH));

const deriveRecordKey = (salt: Buffer): Buffer =>
  Buffer.from(hkdfSync("sha256", getMasterKey(), salt, "astro-vpn-config", KEY_LENGTH));

const looksLikePlaintextConfig = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (
    trimmed.startsWith("vless://") ||
    trimmed.startsWith("vmess://") ||
    trimmed.startsWith("trojan://") ||
    trimmed.startsWith("ss://") ||
    trimmed.startsWith("hy2://") ||
    trimmed.startsWith("ssh://")
  ) {
    return true;
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return trimmed.includes("BEGIN OPENSSH PRIVATE KEY") || trimmed.includes("client\n");
};

export const needsEncryptionUpgrade = (encrypted: EncryptedConfig): boolean =>
  encrypted.version !== CURRENT_VERSION ||
  typeof encrypted.salt !== "string" ||
  encrypted.salt.length === 0;

export const encryptConfig = (plainText: string): EncryptedConfig => {
  const salt = randomBytes(RECORD_SALT_LENGTH);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, deriveRecordKey(salt), iv);
  cipher.setAAD(AAD);
  const cipherText = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: CURRENT_VERSION,
    cipherText: cipherText.toString("base64"),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
};

export const decryptConfig = (encrypted: EncryptedConfig): string => {
  const passCandidates = getPassphraseCandidates();
  const saltCandidates = getDeploymentSaltCandidates();

  const rawSalt = encrypted.salt ?? "";
  const saltBuf = rawSalt ? Buffer.from(rawSalt, "base64") : null;
  const isV3 = encrypted.version === 3 || (saltBuf && saltBuf.length === RECORD_SALT_LENGTH);
  const isV2 = encrypted.version === 2 || (saltBuf && saltBuf.length === V2_SALT_LENGTH);

  // 1. Try V3 decryption with all candidate passphrases and salts
  if (isV3 && saltBuf) {
    const iv = Buffer.from(encrypted.iv, "base64");
    const authTag = Buffer.from(encrypted.authTag, "base64");
    const cipherBuf = Buffer.from(encrypted.cipherText, "base64");

    for (const pass of passCandidates) {
      for (const salt of saltCandidates) {
        try {
          const mKey = getMasterKeyWith(pass, salt, CURRENT_ITERATIONS);
          const rKey = Buffer.from(hkdfSync("sha256", mKey, saltBuf, "astro-vpn-config", KEY_LENGTH));
          const decipher = createDecipheriv(ALGORITHM, rKey, iv);
          decipher.setAAD(AAD);
          decipher.setAuthTag(authTag);
          const dec = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
          return dec.toString("utf8");
        } catch {}
      }
    }
  }

  // 2. Try V2 decryption with all candidate passphrases and salts
  if (isV2 && saltBuf) {
    const iv = Buffer.from(encrypted.iv, "base64");
    const authTag = Buffer.from(encrypted.authTag, "base64");
    const cipherBuf = Buffer.from(encrypted.cipherText, "base64");

    for (const pass of passCandidates) {
      for (const salt of saltCandidates) {
        try {
          const mKey = getMasterKeyWith(pass, salt, V2_ITERATIONS);
          const rKey = Buffer.from(hkdfSync("sha256", mKey, saltBuf, "astro-vpn-config", KEY_LENGTH));
          const decipher = createDecipheriv(ALGORITHM, rKey, iv);
          decipher.setAAD(V2_AAD);
          decipher.setAuthTag(authTag);
          const dec = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
          return dec.toString("utf8");
        } catch {}
      }
    }
  }

  // 3. Try Legacy V1 decryption with all candidate passphrases and salts
  try {
    const iv = Buffer.from(encrypted.iv, "base64");
    const authTag = Buffer.from(encrypted.authTag, "base64");
    const cipherBuf = Buffer.from(encrypted.cipherText, "base64");

    for (const pass of passCandidates) {
      for (const salt of saltCandidates) {
        try {
          const legacyKey = getMasterKeyWith(pass, salt, LEGACY_ITERATIONS);
          const decipher = createDecipheriv(ALGORITHM, legacyKey, iv);
          decipher.setAuthTag(authTag);
          const dec = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
          return dec.toString("utf8");
        } catch {}
      }
    }
  } catch {}

  // 4. Fallback: check if cipherText is plaintext or base64 plaintext
  try {
    const candidate = Buffer.from(encrypted.cipherText, "base64").toString("utf8");
    if (looksLikePlaintextConfig(candidate)) return candidate;
  } catch {}
  if (looksLikePlaintextConfig(encrypted.cipherText)) {
    return encrypted.cipherText;
  }

  throw new Error("Unable to decrypt server config");
};

export const safeEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};
