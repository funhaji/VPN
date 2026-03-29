import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import type { EncryptedConfig } from "@/types/server";
import { getPassphrase } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const ITERATIONS = 310_000;

const getKey = (): Buffer => {
  const passphrase = getPassphrase();
  const salt = process.env.ENCRYPTION_SALT ?? "astro-vpn-neon-salt";
  return pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LENGTH, "sha256");
};

export const encryptConfig = (plainText: string): EncryptedConfig => {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const cipherText = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    cipherText: cipherText.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
};

export const decryptConfig = (encrypted: EncryptedConfig): string => {
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(encrypted.iv, "base64"));
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
