import { createHash } from "node:crypto";
import { safeEquals } from "@/lib/crypto";
import { getPassphrase } from "@/lib/env";

export const SESSION_COOKIE = "astro_admin_session";

const getSessionSecret = (): string => process.env.ADMIN_SESSION_SECRET ?? getPassphrase();

export const createSessionToken = (): string => {
  const payload = `${getPassphrase()}:${getSessionSecret()}:astro-vpn-admin`;
  return createHash("sha256").update(payload).digest("hex");
};

export const hasValidSessionToken = (token: string | undefined): boolean => {
  if (!token) {
    return false;
  }
  return safeEquals(token, createSessionToken());
};
