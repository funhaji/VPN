import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/auth";
import { queryRead, queryWriteNoInvalidate } from "@/lib/db";

// Stored separately from vpn_servers: never serialized into client catalogs.
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await queryRead`SELECT a.key, a.value FROM app_settings a
    WHERE a.key LIKE 'admin_category:%' AND a.value <> ''
    AND EXISTS (SELECT 1 FROM vpn_servers s WHERE s.id::text = substring(a.key from 16));` as { key: string; value: string }[];
  return NextResponse.json({ categories: Object.fromEntries(rows.map(row => [row.key.slice(15), row.value])) }, { headers: { "Cache-Control": "no-store" } });
}

const schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(5000), category: z.string().trim().max(60) });
export async function PUT(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid category assignment" }, { status: 400 });
  const rows = [...new Set(parsed.data.ids)].map(id => ({ key: `admin_category:${id}`, value: parsed.data.category }));
  if (!parsed.data.category) {
    await queryWriteNoInvalidate`DELETE FROM app_settings WHERE key IN (SELECT x.key FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(key text));`;
    return NextResponse.json({ ok: true });
  }
  await queryWriteNoInvalidate`
    INSERT INTO app_settings (key, value, updated_at)
    SELECT x.key, x.value, NOW() FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(key text, value text)
    WHERE EXISTS (SELECT 1 FROM vpn_servers WHERE id::text = substring(x.key from 16))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
  `;
  return NextResponse.json({ ok: true });
}

const renameSchema = z.object({ from: z.string().trim().min(1).max(60), to: z.string().trim().max(60) });
export async function PATCH(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = renameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid category name" }, { status: 400 });
  if (parsed.data.to) {
    await queryWriteNoInvalidate`UPDATE app_settings SET value = ${parsed.data.to}, updated_at = NOW()
      WHERE key LIKE 'admin_category:%' AND value = ${parsed.data.from};`;
  } else {
    await queryWriteNoInvalidate`DELETE FROM app_settings WHERE key LIKE 'admin_category:%' AND value = ${parsed.data.from};`;
  }
  await queryWriteNoInvalidate`DELETE FROM app_settings a WHERE a.key LIKE 'admin_category:%'
    AND NOT EXISTS (SELECT 1 FROM vpn_servers s WHERE s.id::text = substring(a.key from 16));`;
  return NextResponse.json({ ok: true });
}
