import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServer, createServers, deleteAllServers, deleteServersByIds, getServer, listServers, setAllServersEnabled, setServersEnabledByIds, updateServer } from "@/lib/db";
import { encryptConfig, decryptConfig } from "@/lib/crypto";
import { isAuthorized, limitRequest } from "@/lib/auth";
import { applyStoredCredentials } from "@/lib/credentials";
import { detectProfileMetadata } from "@/lib/profile-import";
import { serverInputSchema } from "@/lib/validation";
import { normalizeLocationCode } from "@/lib/countries";

export const dynamic = "force-dynamic";

const revalidateServerCatalog = (): void => {
  revalidatePath("/api/servers");
};

const normalizeEndpoint = (
  input: { host?: string; port?: number; rawConfig: string },
): { host: string; port: number } => {
  if (input.host && input.port) {
    return { host: input.host, port: input.port };
  }

  const detected = detectProfileMetadata(input.rawConfig, "custom:tcp");
  const host = input.host ?? detected.host ?? "embedded-config";
  const portValue = input.port ?? detected.port ?? 443;
  const port = Number.isFinite(portValue) && portValue > 0 ? portValue : 443;
  return { host, port };
};

export async function GET(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const servers = await listServers(false);

    const enriched = servers.map((server) => {
      let accountCount: number | undefined = undefined;

      if (server.protocol.toLowerCase().startsWith("l2tp")) {
        try {
          const raw = decryptConfig(server.encryptedConfig);
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.auths) && parsed.auths.length > 0) {
            accountCount = parsed.auths.length + (parsed.username ? 1 : 0);
          } else if (parsed.username) {
            accountCount = 1;
          }
        } catch {}
      }
      return { ...server, accountCount };
    });
    return NextResponse.json({ servers: enriched });
  } catch (error) {
    console.error("Failed to list servers:", error);
    return NextResponse.json(
      {
        servers: [],
        error: error instanceof Error ? error.message : "Failed to load servers",
      },
      { status: 200 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as { servers?: unknown[] } | unknown;
    if (typeof payload === "object" && payload && Array.isArray((payload as { servers?: unknown[] }).servers)) {
      const incoming = (payload as { servers: unknown[] }).servers;
      if (incoming.length === 0) {
        return NextResponse.json({ error: "Empty server list" }, { status: 400 });
      }
      const validServers = [];
      for (const item of incoming) {
        const parsedItem = serverInputSchema.safeParse(item);
        if (!parsedItem.success) {
          return NextResponse.json({ error: "Invalid payload in bulk list" }, { status: 400 });
        }
        validServers.push(parsedItem.data);
      }
      await createServers(
        validServers.map((data) => {
          const endpoint = normalizeEndpoint(data);
          const rawCountry = (data.country && data.country !== "XX" && data.country !== "GLOBAL")
            ? data.country
            : data.name;
          const safeCountry = normalizeLocationCode(rawCountry);
          return {
            id: randomUUID(),
            name: data.name,
            protocol: data.protocol,
            host: endpoint.host,
            port: endpoint.port,
            country: safeCountry,
            isEnabled: data.isEnabled,
            options: data.options,
            encryptedConfig: encryptConfig(data.rawConfig),
          };
        }),
      );
      revalidateServerCatalog();
      return NextResponse.json({ ok: true, count: validServers.length });
    }

    const parsed = serverInputSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const encryptedConfig = encryptConfig(parsed.data.rawConfig);
    const endpoint = normalizeEndpoint(parsed.data);
    const rawCountry = (parsed.data.country && parsed.data.country !== "XX" && parsed.data.country !== "GLOBAL")
      ? parsed.data.country
      : parsed.data.name;
    const safeCountry = normalizeLocationCode(rawCountry);

    await createServer({
      id: randomUUID(),
      name: parsed.data.name,
      protocol: parsed.data.protocol,
      host: endpoint.host,
      port: endpoint.port,
      country: safeCountry,
      isEnabled: parsed.data.isEnabled,
      options: parsed.data.options,
      encryptedConfig,
    });

    revalidateServerCatalog();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as {
      action?: unknown;
      ids?: unknown;
      username?: unknown;
      password?: unknown;
    };
    const action = typeof payload.action === "string" ? payload.action : "";

    if (action === "update-credentials") {
      if (!Array.isArray(payload.ids) || payload.ids.length === 0) {
        return NextResponse.json({ error: "Select at least one server" }, { status: 400 });
      }
      const username = typeof payload.username === "string" ? payload.username : undefined;
      const password = typeof payload.password === "string" ? payload.password : undefined;
      const psk = typeof (payload as { psk?: unknown }).psk === "string" ? (payload as { psk?: string }).psk : undefined;
      if (username === undefined && password === undefined && psk === undefined) {
        return NextResponse.json({ error: "Provide a username, password, and/or PSK to update" }, { status: 400 });
      }

      let updated = 0;
      const errors: string[] = [];
      for (const rawId of payload.ids) {
        if (typeof rawId !== "string" || !/^[0-9a-f-]{36}$/i.test(rawId)) {
          continue;
        }
        const server = await getServer(rawId);
        if (!server) continue;
        try {
          const rawConfig = decryptConfig(server.encryptedConfig);
          const nextConfig = applyStoredCredentials(rawConfig, server.protocol, { username, password, psk } as Parameters<typeof applyStoredCredentials>[2] & { psk?: string });
          await updateServer(rawId, { encryptedConfig: encryptConfig(nextConfig) });
          updated += 1;
        } catch (error) {
          errors.push(
            `${server.name}: ${error instanceof Error ? error.message : "Credential update failed"}`,
          );
        }
      }

      if (updated === 0) {
        return NextResponse.json(
          { error: errors[0] ?? "No servers were updated" },
          { status: 400 },
        );
      }

      revalidateServerCatalog();
      return NextResponse.json({
        ok: true,
        updated,
        ...(errors.length > 0 ? { warnings: errors } : {}),
      });
    }

    if (action === "bulk-add-extra-auths") {
      if (!Array.isArray(payload.ids) || payload.ids.length === 0) {
        return NextResponse.json({ error: "Select at least one server" }, { status: 400 });
      }
      const rawIncomingAuths = (payload as { auths?: unknown }).auths;
      if (!Array.isArray(rawIncomingAuths) || rawIncomingAuths.length === 0) {
        return NextResponse.json({ error: "Provide at least one extra account" }, { status: 400 });
      }
      const mode = (payload as { mode?: unknown }).mode === "replace" ? "replace" : "append";

      const cleanAuths: Array<{ username: string; password: string; psk?: string }> = [];
      for (const item of rawIncomingAuths) {
        if (item && typeof item === "object") {
          const u = String((item as Record<string, unknown>).username || "").trim();
          const p = String((item as Record<string, unknown>).password || "").trim();
          const k = String((item as Record<string, unknown>).psk || "").trim();
          if (u && p) {
            cleanAuths.push({
              username: u,
              password: p,
              ...(k ? { psk: k } : {}),
            });
          }
        }
      }

      if (cleanAuths.length === 0) {
        return NextResponse.json({ error: "No valid accounts provided" }, { status: 400 });
      }

      let updated = 0;
      for (const rawId of payload.ids) {
        if (typeof rawId !== "string" || !/^[0-9a-f-]{36}$/i.test(rawId)) continue;
        const server = await getServer(rawId);
        if (!server || !server.protocol.toLowerCase().startsWith("l2tp")) continue;
        try {
          const rawConfig = decryptConfig(server.encryptedConfig);
          const parsed = JSON.parse(rawConfig);
          if (mode === "replace") {
            parsed.auths = cleanAuths;
          } else {
            const existing: Array<{ username: string; password: string; psk?: string }> = Array.isArray(parsed.auths)
              ? parsed.auths
              : [];
            for (const ca of cleanAuths) {
              if (!existing.some((e) => e.username === ca.username && e.password === ca.password)) {
                existing.push(ca);
              }
            }
            parsed.auths = existing;
          }
          const nextConfig = JSON.stringify(parsed);
          await updateServer(rawId, { encryptedConfig: encryptConfig(nextConfig) });
          updated++;
        } catch {}
      }

      revalidateServerCatalog();
      return NextResponse.json({ ok: true, updated });
    }

    if (action === "bulk-clear-extra-auths") {
      if (!Array.isArray(payload.ids) || payload.ids.length === 0) {
        return NextResponse.json({ error: "Select at least one server" }, { status: 400 });
      }
      let updated = 0;
      for (const rawId of payload.ids) {
        if (typeof rawId !== "string" || !/^[0-9a-f-]{36}$/i.test(rawId)) continue;
        const server = await getServer(rawId);
        if (!server || !server.protocol.toLowerCase().startsWith("l2tp")) continue;
        try {
          const rawConfig = decryptConfig(server.encryptedConfig);
          const parsed = JSON.parse(rawConfig);
          delete parsed.auths;
          const nextConfig = JSON.stringify(parsed);
          await updateServer(rawId, { encryptedConfig: encryptConfig(nextConfig) });
          updated++;
        } catch {}
      }

      revalidateServerCatalog();
      return NextResponse.json({ ok: true, updated });
    }

    if (action === "bulk-set-notice") {
      if (!Array.isArray(payload.ids) || payload.ids.length === 0) {
        return NextResponse.json({ error: "Select at least one server" }, { status: 400 });
      }
      const notice = typeof (payload as { notice?: unknown }).notice === "string"
        ? (payload as { notice: string }).notice.trim()
        : "";
      let updated = 0;
      for (const rawId of payload.ids) {
        if (typeof rawId !== "string" || !/^[0-9a-f-]{36}$/i.test(rawId)) continue;
        const server = await getServer(rawId);
        if (!server) continue;
        const options = { ...server.options, extra: { ...server.options.extra } };
        if (notice) {
          options.extra.notice = notice;
        } else {
          delete options.extra.notice;
        }
        await updateServer(rawId, { options });
        updated += 1;
      }
      revalidateServerCatalog();
      return NextResponse.json({ ok: true, updated });
    }

    if (action === "bulk-edit-v2ray") {
      if (!Array.isArray(payload.ids) || payload.ids.length === 0) {
        return NextResponse.json({ error: "Select at least one server" }, { status: 400 });
      }
      const v2Data = (payload as { v2ray?: Record<string, unknown> }).v2ray || {};
      const host = typeof v2Data.host === "string" ? v2Data.host.trim() : "";
      const port = typeof v2Data.port === "number" ? v2Data.port : (Number(v2Data.port) || 0);
      const uuid = typeof v2Data.uuid === "string" ? v2Data.uuid.trim() : "";
      const sni = typeof v2Data.sni === "string" ? v2Data.sni.trim() : "";
      const path = typeof v2Data.path === "string" ? v2Data.path.trim() : "";
      const network = typeof v2Data.network === "string" ? v2Data.network.trim() : "";
      const mux = typeof v2Data.mux === "boolean" ? v2Data.mux : undefined;

      let updated = 0;
      const errors: string[] = [];
      for (const rawId of payload.ids) {
        if (typeof rawId !== "string" || !/^[0-9a-f-]{36}$/i.test(rawId)) continue;
        const server = await getServer(rawId);
        if (!server) continue;
        try {
          const raw = decryptConfig(server.encryptedConfig);
          let nextRaw = raw;
          if (raw.trim().startsWith("{")) {
            const parsed = JSON.parse(raw);
            if (parsed.outbounds && Array.isArray(parsed.outbounds)) {
              for (const ob of parsed.outbounds) {
                if (ob.settings?.vnext && Array.isArray(ob.settings.vnext) && ob.settings.vnext[0]) {
                  if (host) ob.settings.vnext[0].address = host;
                  if (port > 0) ob.settings.vnext[0].port = port;
                  if (uuid && Array.isArray(ob.settings.vnext[0].users) && ob.settings.vnext[0].users[0]) {
                    ob.settings.vnext[0].users[0].id = uuid;
                  }
                }
                if (ob.settings?.servers && Array.isArray(ob.settings.servers) && ob.settings.servers[0]) {
                  if (host) ob.settings.servers[0].address = host;
                  if (port > 0) ob.settings.servers[0].port = port;
                  if (uuid) ob.settings.servers[0].password = uuid;
                }
                if (ob.streamSettings) {
                  if (network) ob.streamSettings.network = network;
                  if (sni) {
                    if (ob.streamSettings.tlsSettings) ob.streamSettings.tlsSettings.serverName = sni;
                    if (ob.streamSettings.realitySettings) ob.streamSettings.realitySettings.serverNames = [sni];
                  }
                  if (path) {
                    if (ob.streamSettings.wsSettings) ob.streamSettings.wsSettings.path = path;
                    if (ob.streamSettings.xhttpSettings) ob.streamSettings.xhttpSettings.path = path;
                    if (ob.streamSettings.httpSettings) ob.streamSettings.httpSettings.path = path;
                    if (ob.streamSettings.grpcSettings) ob.streamSettings.grpcSettings.serviceName = path;
                  }
                }
                if (mux !== undefined) {
                  ob.mux = ob.mux || {};
                  ob.mux.enabled = mux;
                }
              }
              nextRaw = JSON.stringify(parsed, null, 2);
            }
          }
          const updatePayload: Parameters<typeof updateServer>[1] = {
            encryptedConfig: encryptConfig(nextRaw),
          };
          if (host) updatePayload.host = host;
          if (port > 0) updatePayload.port = port;
          if (mux !== undefined) {
            updatePayload.options = { ...server.options, mux };
          }
          await updateServer(rawId, updatePayload);
          updated += 1;
        } catch (err) {
          errors.push(`${server.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      revalidateServerCatalog();
      return NextResponse.json({ ok: true, updated, warnings: errors.length > 0 ? errors : undefined });
    }

    if (action === "enable-selected" || action === "disable-selected") {
      if (!Array.isArray(payload.ids) || payload.ids.length === 0) {
        return NextResponse.json({ error: "Select at least one server" }, { status: 400 });
      }
      const validIds = payload.ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));
      if (validIds.length === 0) {
        return NextResponse.json({ error: "No valid server IDs provided" }, { status: 400 });
      }
      const changed = await setServersEnabledByIds(validIds, action === "enable-selected");
      revalidateServerCatalog();
      return NextResponse.json({ ok: true, changed });
    }

    if (action !== "enable-all" && action !== "disable-all") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const changed = await setAllServersEnabled(action === "enable-all");
    revalidateServerCatalog();
    return NextResponse.json({ ok: true, changed });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let payload: { ids?: unknown } | null = null;
    try {
      payload = (await request.json()) as { ids?: unknown };
    } catch {
      payload = null;
    }

    if (payload && Array.isArray(payload.ids) && payload.ids.length > 0) {
      const validIds = payload.ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));
      if (validIds.length === 0) {
        return NextResponse.json({ error: "No valid server IDs provided" }, { status: 400 });
      }
      const deleted = await deleteServersByIds(validIds);
      revalidateServerCatalog();
      return NextResponse.json({ ok: true, deleted });
    }

    const deleted = await deleteAllServers();
    revalidateServerCatalog();
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 500 },
    );
  }
}
