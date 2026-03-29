import { NextRequest } from "next/server";
import { safeEquals } from "@/lib/crypto";
import { getPassphrase } from "@/lib/env";
import { hasValidSessionToken, SESSION_COOKIE } from "@/lib/session";

const WINDOW_MS = 60_000;
const MAX_HITS = 30;

const requestMap = new Map<string, { hitCount: number; windowStart: number }>();

export const limitRequest = (request: NextRequest): boolean => {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const existing = requestMap.get(ip);

  if (!existing || now - existing.windowStart > WINDOW_MS) {
    requestMap.set(ip, { hitCount: 1, windowStart: now });
    return true;
  }

  if (existing.hitCount >= MAX_HITS) {
    return false;
  }

  existing.hitCount += 1;
  requestMap.set(ip, existing);
  return true;
};

export const isAuthorized = (request: NextRequest): boolean => {
  const headerToken = request.headers.get("x-admin-pass");
  if (headerToken && safeEquals(headerToken, getPassphrase())) {
    return true;
  }
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  return hasValidSessionToken(sessionToken);
};
