import { NextRequest, NextResponse } from "next/server";
import { safeEquals } from "@/lib/crypto";
import { getPassphraseCandidates } from "@/lib/env";
import { limitRequest } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

export async function POST(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = (await request.json()) as { pass?: string };
    const rawPass = typeof body?.pass === "string" ? body.pass.trim().replace(/^["']|["']$/g, "") : "";
    const candidates = getPassphraseCandidates();

    if (!rawPass || !candidates.some((pass) => safeEquals(rawPass, pass))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: SESSION_COOKIE,
      value: createSessionToken(),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}
