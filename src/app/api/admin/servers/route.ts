import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServer, createServers, deleteAllServers, deleteServersByIds, getServer, listServers, renameServers, setAllServersEnabled, setServersEnabledByIds, updateServer } from "@/lib/db";
import { encryptConfig, decryptConfig } from "@/lib/crypto";
import { isAuthorized, limitRequest } from "@/lib/auth";
import { applyStoredCredentials } from "@/lib/credentials";
import { detectProfileMetadata } from "@/lib/profile-import";
import { serverInputSchema } from "@/lib/validation";
import { normalizeLocationCode } from "@/lib/countries";
import { createAutoNamer, namingServersForTier, planLocationRename } from "@/lib/server-naming";
import { checkServerDuplicates } from "@/lib/duplicate-check";
import { savePremiumServer } from "@/lib/premium-service";
import { ensurePremiumSchema, premiumDb } from "@/lib/premium-db";

export const dynamic = "force-dynamic";

const revalidateServerCatalog = (): void => {
  revalidatePath("/api/servers");
};

async function creationNamers(needsFree: boolean, needsPremium: boolean) {
  const catalog = await listServers(false);
  let premium: { id: string; name: string; country: string }[] = [];
  if (needsPremium) {
    await ensurePremiumSchema();
    premium = await premiumDb()`SELECT id, name, country FROM premium_servers`;
  }
  return {
    free: needsFree ? createAutoNamer(namingServersForTier(catalog, [], false)) : null,
    premium: needsPremium ? createAutoNamer(namingServersForTier(catalog, premium, true)) : null,
  };
}

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
      // Never ship ciphertext to the browser: it bloats the payload and the
      // UI fetches a single server's config on demand when editing.
      const { encryptedConfig: _omit, ...summary } = server;
      void _omit;
      return { ...summary, accountCount };
    });
    return NextResponse.json({ servers: enriched }, { headers: { "Cache-Control": "no-store" } });
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
      const batchAutoName = (payload as { autoName?: unknown }).autoName === true;
      const validServers = [];
      for (const item of incoming) {
        const parsedItem = serverInputSchema.safeParse(item);
        if (!parsedItem.success) {
          return NextResponse.json({ error: "Invalid payload in bulk list" }, { status: 400 });
        }
        const itemAutoName = batchAutoName || (typeof item === "object" && item !== null && (item as { autoName?: unknown }).autoName === true);
        validServers.push({ data: parsedItem.data, autoName: itemAutoName });
      }
      const duplicates = await checkServerDuplicates(validServers.map(({ data }) => data));
      if (duplicates.some(match => match.kind === "duplicate")) {
        return NextResponse.json({ error: `Duplicate server: ${duplicates.filter(match => match.kind === "duplicate").map(match => `${match.incoming} matches ${match.existing}`).slice(0, 10).join("; ")}`, duplicates }, { status: 409 });
      }
      // Auto-naming is computed here against the live server list so numbering
      // is always based on what is actually stored, not on a stale client view.
      const namers = validServers.some(entry => entry.autoName)
        ? await creationNamers(validServers.some(entry => entry.autoName && !entry.data.isPremium), validServers.some(entry => entry.autoName && entry.data.isPremium)) : null;
      const records = validServers.map(({ data, autoName }) => {
        const endpoint = normalizeEndpoint(data);
        const rawCountry = (data.country && data.country !== "XX" && data.country !== "GLOBAL")
          ? data.country
          : data.name;
        const safeCountry = normalizeLocationCode(rawCountry);
        const name = (autoName && (data.isPremium ? namers?.premium : namers?.free)?.next(safeCountry)) || data.name;
        return {
          id: randomUUID(),
          name,
          protocol: data.protocol,
          host: endpoint.host,
          port: endpoint.port,
          country: safeCountry,
          isEnabled: data.isEnabled,
          isPremium: data.isPremium,
          options: data.options,
          encryptedConfig: encryptConfig(data.rawConfig),
        };
      });
      await createServers(records);
      const premiumWarnings: string[] = duplicates.filter(match => match.kind === "duplicate").map(match => `${match.incoming} matches ${match.existing}`);
      for (let i = 0; i < records.length; i += 1) {
        if (!records[i].isPremium) continue;
        try {
          await savePremiumServer({ name: records[i].name, country: records[i].country, node: validServers[i].data.premiumNode ?? "default", rawConfig: validServers[i].data.rawConfig, id: records[i].id });
        } catch (premiumError) {
          console.error("Failed to register premium server:", premiumError);
          premiumWarnings.push(`${records[i].name}: saved but not registered as premium (premium database unavailable)`);
        }
      }
      revalidateServerCatalog();
      return NextResponse.json({ ok: true, count: records.length, names: records.map((record) => record.name), warnings: duplicates.length > 0 ? duplicates : [] , premiumWarnings: premiumWarnings.length > 0 ? premiumWarnings : undefined });
    }

    const parsed = serverInputSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const duplicates = await checkServerDuplicates([parsed.data]);
    if (duplicates.some(match => match.kind === "duplicate")) {
      return NextResponse.json({ error: `Duplicate server: matches ${duplicates.find(match => match.kind === "duplicate")!.existing}`, duplicates }, { status: 409 });
    }
    const encryptedConfig = encryptConfig(parsed.data.rawConfig);
    const endpoint = normalizeEndpoint(parsed.data);
    const rawCountry = (parsed.data.country && parsed.data.country !== "XX" && parsed.data.country !== "GLOBAL")
      ? parsed.data.country
      : parsed.data.name;
    const safeCountry = normalizeLocationCode(rawCountry);
    const autoName = (payload as { autoName?: unknown }).autoName === true;
    const namers = autoName ? await creationNamers(!parsed.data.isPremium, parsed.data.isPremium) : null;
    const name = (autoName && (parsed.data.isPremium ? namers?.premium : namers?.free)?.next(safeCountry)) || parsed.data.name;

    const serverId = randomUUID();
    await createServer({
      id: serverId,
      name,
      protocol: parsed.data.protocol,
      host: endpoint.host,
      port: endpoint.port,
      country: safeCountry,
      isEnabled: parsed.data.isEnabled,
      isPremium: parsed.data.isPremium,
      options: parsed.data.options,
      encryptedConfig,
    });

    let premiumWarning: string | undefined;
    if (parsed.data.isPremium) {
      try {
        await savePremiumServer({ id: serverId, name, country: safeCountry, node: parsed.data.premiumNode ?? "default", rawConfig: parsed.data.rawConfig });
      } catch (premiumError) {
        console.error("Failed to register premium server:", premiumError);
        premiumWarning = "Server saved, but it could not be registered as premium because the premium database is unavailable. Tick it again via the premium panel once the database is connected.";
      }
    }

    revalidateServerCatalog();
    return NextResponse.json({ ok: true, name, ...(premiumWarning ? { warning: premiumWarning } : {}) });
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

    if (action === "set-premium") {
      if (!Array.isArray(payload.ids) || payload.ids.length === 0) {
        return NextResponse.json({ error: "Select at least one server" }, { status: 400 });
      }
      const isPremium = (payload as { isPremium?: unknown }).isPremium === true;
      let updated = 0;
      for (const rawId of payload.ids) {
        if (typeof rawId !== "string" || !/^[0-9a-f-]{36}$/i.test(rawId)) continue;
        await updateServer(rawId, { isPremium });
        if (!isPremium) {
          try { await premiumDb()`DELETE FROM premium_servers WHERE id = ${rawId}`; } catch (premiumError) {
            console.error("Failed to remove premium mirror:", premiumError);
          }
        } else {
          try {
            const record = await getServer(rawId);
            const raw = record ? decryptConfig(record.encryptedConfig) : "";
            if (record) await savePremiumServer({ id: rawId, name: record.name, country: record.country, node: "default", rawConfig: raw });
          } catch (premiumError) {
            console.error("Failed to register premium server:", premiumError);
          }
        }
        updated += 1;
      }
      if (updated === 0) return NextResponse.json({ error: "No servers were updated" }, { status: 400 });
      revalidateServerCatalog();
      return NextResponse.json({ ok: true, updated, isPremium });
    }

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
          const duplicate = (await checkServerDuplicates([{ ...server, rawConfig: nextConfig }], [rawId])).find(match => match.kind === "duplicate");
          if (duplicate) throw new Error(`Duplicate server: matches ${duplicate.existing}`);
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
          const duplicate = (await checkServerDuplicates([{ ...server, rawConfig: nextConfig }], [rawId])).find(match => match.kind === "duplicate");
          if (duplicate) continue;
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
          const duplicate = (await checkServerDuplicates([{ ...server, rawConfig: nextConfig }], [rawId])).find(match => match.kind === "duplicate");
          if (duplicate) continue;
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
          const duplicate = (await checkServerDuplicates([{ ...server, host: host || server.host, port: port > 0 ? port : server.port, rawConfig: nextRaw }], [rawId])).find(match => match.kind === "duplicate");
          if (duplicate) throw new Error(`Duplicate server: matches ${duplicate.existing}`);
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

    if (action === "auto-name") {
      // Rename servers to their location ("🇩🇪 Germany", "🇩🇪 Germany 2", ...).
      // `ids` limits the rename to specific servers; omit it to rename everything.
      let targetIds: string[] | undefined;
      if (payload.ids !== undefined) {
        if (!Array.isArray(payload.ids) || payload.ids.length === 0) {
          return NextResponse.json({ error: "Select at least one server" }, { status: 400 });
        }
        targetIds = payload.ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));
        if (targetIds.length === 0) {
          return NextResponse.json({ error: "No valid server IDs provided" }, { status: 400 });
        }
      }
      const plan = planLocationRename(await listServers(false), targetIds);
      await renameServers(plan.changes.map((change) => ({ id: change.id, name: change.newName })));
      if (plan.changes.length > 0) revalidateServerCatalog();
      return NextResponse.json({
        ok: true,
        renamed: plan.changes.length,
        unchanged: plan.unchanged,
        skipped: plan.skipped.length,
      });
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
