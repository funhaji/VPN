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

const V1_ALGORITHM = "aes-256-gcm";
const V2_ALGORITHM = "aes-256-gcm";
const V2_TAG_PREFIX = "v2:";
const V2_AAD = "astro-vpn-config:v2";
const KEY_LENGTH = 32;
const V1_ITERATIONS = 310_000;
const V2_SALT_LENGTH = 16;
const V2_IV_LENGTH = 12;

let cachedV1Key: Buffer | null = null;

const getV1Key = (): Buffer => {
  if (cachedV1Key) {
    return cachedV1Key;
  }
  const passphrase = getPassphrase();
  const salt = process.env.ENCRYPTION_SALT ?? "AUGabgabgoag";
  cachedV1Key = pbkdf2Sync(passphrase, salt, V1_ITERATIONS, KEY_LENGTH, "sha256");
  return cachedV1Key;
};

const deriveV2Key = (salt: Buffer): Buffer =>
  Buffer.from(hkdfSync("sha256", getV1Key(), salt, V2_AAD, KEY_LENGTH));

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

const decryptV1 = (encrypted: EncryptedConfig): string => {
  const decipher = createDecipheriv(V1_ALGORITHM, getV1Key(), Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.cipherText, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
};

const decryptV2 = (encrypted: EncryptedConfig): string => {
  const salt = Buffer.from(encrypted.iv, "base64");
  const iv = Buffer.from(encrypted.cipherText, "base64").subarray(0, V2_IV_LENGTH);
  const cipherBytes = Buffer.from(encrypted.cipherText, "base64").subarray(V2_IV_LENGTH);
  const authTag = Buffer.from(encrypted.authTag.slice(V2_TAG_PREFIX.length), "base64");
  const key = deriveV2Key(salt);

  const decipher = createDecipheriv(V2_ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(V2_AAD, "utf8"));
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(cipherBytes), decipher.final()]);
  return decrypted.toString("utf8");
};

export const isV2EncryptedConfig = (encrypted: EncryptedConfig): boolean =>
  encrypted.authTag.startsWith(V2_TAG_PREFIX);

export const encryptConfig = (plainText: string): EncryptedConfig => {
  const salt = randomBytes(V2_SALT_LENGTH);
  const iv = randomBytes(V2_IV_LENGTH);
  const key = deriveV2Key(salt);
  const cipher = createCipheriv(V2_ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(V2_AAD, "utf8"));
  const cipherBytes = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    cipherText: Buffer.concat([iv, cipherBytes]).toString("base64"),
    iv: salt.toString("base64"),
    authTag: `${V2_TAG_PREFIX}${authTag.toString("base64")}`,
  };
};

export const decryptConfig = (encrypted: EncryptedConfig): string => {
  if (isV2EncryptedConfig(encrypted)) {
    return decryptV2(encrypted);
  }

  try {
    return decryptV1(encrypted);
  } catch {
    const legacyCandidate = Buffer.from(encrypted.cipherText, "base64").toString("utf8");
    if (looksLikePlaintextConfig(legacyCandidate)) {
      return legacyCandidate;
    }
    const rawCandidate = encrypted.cipherText;
    if (looksLikePlaintextConfig(rawCandidate)) {
      return rawCandidate;
    }
    throw new Error("Unable to decrypt server config");
  }
};

export const needsConfigReencryption = (encrypted: EncryptedConfig): boolean =>
  !isV2EncryptedConfig(encrypted);

export const safeEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};
