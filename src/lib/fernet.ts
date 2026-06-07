import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const VERSION = 0x80;
const IV_LENGTH = 16;
const HMAC_LENGTH = 32;
const TIMESTAMP_LENGTH = 8;

export const deriveFernetKey = (secret: string, info = "fernet-key"): Buffer =>
  Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), "astro-vpn-catalog-v1", info, 32));

const sign = (signingKey: Buffer, payload: Buffer): Buffer =>
  createHmac("sha256", signingKey).update(payload).digest();

export const encryptFernet = (plainText: string, key: Buffer): string => {
  if (key.length !== 32) {
    throw new Error("Fernet key must be 32 bytes");
  }

  const signingKey = key.subarray(0, 16);
  const encryptionKey = key.subarray(16, 32);
  const iv = randomBytes(IV_LENGTH);
  const timestamp = Buffer.alloc(TIMESTAMP_LENGTH);
  timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));

  const cipher = createCipheriv("aes-128-cbc", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const hmacPayload = Buffer.concat([Buffer.from([VERSION]), timestamp, iv, ciphertext]);
  const hmac = sign(signingKey, hmacPayload);
  const token = Buffer.concat([Buffer.from([VERSION]), timestamp, iv, ciphertext, hmac]);

  return token.toString("base64url");
};

export const decryptFernet = (token: string, key: Buffer, maxAgeSeconds?: number): string => {
  if (key.length !== 32) {
    throw new Error("Fernet key must be 32 bytes");
  }

  const signingKey = key.subarray(0, 16);
  const encryptionKey = key.subarray(16, 32);
  const data = Buffer.from(token, "base64url");

  if (data.length < 1 + TIMESTAMP_LENGTH + IV_LENGTH + HMAC_LENGTH + 1) {
    throw new Error("Invalid Fernet token");
  }
  if (data[0] !== VERSION) {
    throw new Error("Unsupported Fernet version");
  }

  const timestamp = data.subarray(1, 1 + TIMESTAMP_LENGTH);
  const iv = data.subarray(1 + TIMESTAMP_LENGTH, 1 + TIMESTAMP_LENGTH + IV_LENGTH);
  const hmac = data.subarray(-HMAC_LENGTH);
  const ciphertext = data.subarray(1 + TIMESTAMP_LENGTH + IV_LENGTH, -HMAC_LENGTH);
  const hmacPayload = data.subarray(0, -HMAC_LENGTH);
  const expectedHmac = sign(signingKey, hmacPayload);

  if (hmac.length !== expectedHmac.length || !timingSafeEqual(hmac, expectedHmac)) {
    throw new Error("Fernet HMAC verification failed");
  }

  if (maxAgeSeconds !== undefined) {
    const issuedAt = Number(timestamp.readBigUInt64BE());
    const now = Math.floor(Date.now() / 1000);
    if (now - issuedAt > maxAgeSeconds) {
      throw new Error("Fernet token expired");
    }
  }

  const decipher = createDecipheriv("aes-128-cbc", encryptionKey, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
};
