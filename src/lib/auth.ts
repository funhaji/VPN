import { NextRequest } from "next/server";
import { safeEquals } from "@/lib/crypto";
import { getPassphrase } from "@/lib/env";

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
  const token = request.headers.get("x-admin-pass");
  if (!token) {
    return false;
  }
  return safeEquals(token, getPassphrase());
};
