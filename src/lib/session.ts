import { createHmac, randomBytes } from "node:crypto";
import { safeEquals } from "@/lib/crypto";
import { getPassphrase } from "@/lib/env";

export const SESSION_COOKIE = "astro_admin_session";

const getSessionSecret = (): string => process.env.ADMIN_SESSION_SECRET ?? getPassphrase();
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const SESSION_VERSION = "v1";

const signPayload = (payload: string): string =>
  createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");

export const createSessionToken = (): string => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(12).toString("base64url");
  const payload = `${SESSION_VERSION}.${issuedAt}.${nonce}`;
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
};

export const hasValidSessionToken = (token: string | undefined): boolean => {
  if (!token) {
    return false;
  }
  const parts = token.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const [version, issuedAtRaw, nonce, signature] = parts;
  if (version !== SESSION_VERSION || !nonce || !signature) {
    return false;
  }

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isInteger(issuedAt) || issuedAt <= 0) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now + 60 || now - issuedAt > SESSION_MAX_AGE_SECONDS) {
    return false;
  }

  const payload = `${version}.${issuedAtRaw}.${nonce}`;
  return safeEquals(signature, signPayload(payload));
};
