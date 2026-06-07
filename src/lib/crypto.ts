import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { EncryptedConfig } from "@/types/server";
import { getPassphrase } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const LEGACY_ITERATIONS = 310_000;
const CURRENT_ITERATIONS = 600_000;
const CURRENT_VERSION = 2;
const RECORD_SALT_LENGTH = 16;
const AAD = Buffer.from("astro-vpn-config:v2", "utf8");

let cachedLegacyKey: Buffer | null = null;
let cachedMasterKey: Buffer | null = null;

const getDeploymentSalt = (): string => process.env.ENCRYPTION_SALT ?? "AUGabgabgoag";

const getLegacyKey = (): Buffer => {
  if (cachedLegacyKey) {
    return cachedLegacyKey;
  }
  cachedLegacyKey = pbkdf2Sync(
    getPassphrase(),
    getDeploymentSalt(),
    LEGACY_ITERATIONS,
    KEY_LENGTH,
    "sha256",
  );
  return cachedLegacyKey;
};

const getMasterKey = (): Buffer => {
  if (cachedMasterKey) {
    return cachedMasterKey;
  }
  cachedMasterKey = pbkdf2Sync(
    getPassphrase(),
    getDeploymentSalt(),
    CURRENT_ITERATIONS,
    KEY_LENGTH,
    "sha256",
  );
  return cachedMasterKey;
};

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

const decryptLegacyConfig = (encrypted: EncryptedConfig): string => {
  const decipher = createDecipheriv(ALGORITHM, getLegacyKey(), Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.cipherText, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
};

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
  if (needsEncryptionUpgrade(encrypted)) {
    try {
      return decryptLegacyConfig(encrypted);
    } catch {
      const legacyCandidate = Buffer.from(encrypted.cipherText, "base64").toString("utf8");
      if (looksLikePlaintextConfig(legacyCandidate)) {
        return legacyCandidate;
      }
      if (looksLikePlaintextConfig(encrypted.cipherText)) {
        return encrypted.cipherText;
      }
      throw new Error("Unable to decrypt server config");
    }
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    deriveRecordKey(Buffer.from(encrypted.salt ?? "", "base64")),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.cipherText, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
};

export const safeEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};
