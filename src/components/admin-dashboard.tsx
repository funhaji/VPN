"use client";

import { useCallback, useMemo, useState } from "react";
import type { ServerRecord } from "@/types/server";

type FormState = {
  name: string;
  family: string;
  variant: string;
  host: string;
  port: string;
  country: string;
  rawConfig: string;
  extraJson: string;
  mux: boolean;
  fragment: boolean;
  sniffing: boolean;
  allowInsecure: boolean;
};

const baseForm: FormState = {
  name: "",
  family: "v2ray",
  variant: "vless",
  host: "",
  port: "443",
  country: "",
  rawConfig: "",
  extraJson: "{}",
  mux: false,
  fragment: false,
  sniffing: true,
  allowInsecure: false,
};

const protocolFamilies = [
  "v2ray",
  "ssh",
  "openvpn",
  "wireguard",
  "sing-box",
  "custom",
];

const optionItems: Array<{ key: "mux" | "fragment" | "sniffing" | "allowInsecure"; label: string }> = [
  { key: "mux", label: "Mux" },
  { key: "fragment", label: "Fragment" },
  { key: "sniffing", label: "Sniffing" },
  { key: "allowInsecure", label: "AllowInsecure" },
];

export function AdminDashboard() {
  const [form, setForm] = useState<FormState>(baseForm);
  const [bulkPayload, setBulkPayload] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [mode, setMode] = useState<"single" | "bulk">("single");

  const protocol = useMemo(() => {
    const family = form.family.trim().toLowerCase();
    const variant = form.variant.trim().toLowerCase();
    return variant.length > 0 ? `${family}:${variant}` : family;
  }, [form.family, form.variant]);

  const apiCall = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Request failed");
      }
      return (await response.json()) as T;
    },
    [],
  );

  const refreshServers = useCallback(async () => {
    setBusy(true);
    try {
      const data = await apiCall<{ servers: ServerRecord[] }>("/api/admin/servers");
      setServers(data.servers);
      setMessage("Server list refreshed");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to refresh");
    } finally {
      setBusy(false);
    }
  }, [apiCall]);

  const submitServer = useCallback(async () => {
    setBusy(true);
    try {
      const extra = JSON.parse(form.extraJson) as Record<string, string | number | boolean>;
      await apiCall<{ ok: boolean }>("/api/admin/servers", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          protocol,
          host: form.host.trim(),
          port: Number(form.port),
          country: form.country.trim(),
          rawConfig: form.rawConfig.trim(),
          isEnabled: true,
          options: {
            mux: form.mux,
            fragment: form.fragment,
            sniffing: form.sniffing,
            allowInsecure: form.allowInsecure,
            extra,
          },
        }),
      });
      setForm(baseForm);
      setMessage("Server created");
      await refreshServers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }, [apiCall, form, protocol, refreshServers]);

  const submitBulk = useCallback(async () => {
    setBusy(true);
    try {
      const parsed = JSON.parse(bulkPayload) as Array<{
        name: string;
        family?: string;
        variant?: string;
        protocol?: string;
        host: string;
        port: number;
        country: string;
        rawConfig: string;
        options?: {
          mux?: boolean;
          fragment?: boolean;
          sniffing?: boolean;
          allowInsecure?: boolean;
          extra?: Record<string, string | number | boolean>;
        };
      }>;
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Bulk payload must be a non-empty JSON array");
      }
      const servers = parsed.map((item) => ({
        name: item.name,
        protocol:
          item.protocol ??
          `${(item.family ?? "custom").trim().toLowerCase()}:${(item.variant ?? "").trim().toLowerCase()}`,
        host: item.host,
        port: Number(item.port),
        country: item.country,
        rawConfig: item.rawConfig,
        isEnabled: true,
        options: {
          mux: Boolean(item.options?.mux),
          fragment: Boolean(item.options?.fragment),
          sniffing: Boolean(item.options?.sniffing),
          allowInsecure: Boolean(item.options?.allowInsecure),
          extra: item.options?.extra ?? {},
        },
      }));
      await apiCall<{ ok: boolean; count: number }>("/api/admin/servers", {
        method: "POST",
        body: JSON.stringify({ servers }),
      });
      setMessage(`Bulk imported ${servers.length} servers`);
      setBulkPayload("");
      await refreshServers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bulk import failed");
    } finally {
      setBusy(false);
    }
  }, [apiCall, bulkPayload, refreshServers]);

  const toggleServer = useCallback(
    async (id: string, isEnabled: boolean) => {
      setBusy(true);
      try {
        await apiCall<{ ok: boolean }>(`/api/admin/servers/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ isEnabled }),
        });
        await refreshServers();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to toggle");
      } finally {
        setBusy(false);
      }
    },
    [apiCall, refreshServers],
  );

  const removeServer = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await apiCall<{ ok: boolean }>(`/api/admin/servers/${id}`, { method: "DELETE" });
        await refreshServers();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to delete");
      } finally {
        setBusy(false);
      }
    },
    [apiCall, refreshServers],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 md:px-8">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-lg shadow-black/25">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-zinc-50">Astro VPN Server Control</h2>
            <p className="mt-1 text-sm text-zinc-400">Telegram: AstroVPN_Official</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setMode("single")}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${mode === "single" ? "bg-cyan-400 text-cyan-950" : "border border-zinc-700 text-zinc-200"}`}
            >
              Single Add
            </button>
            <button
              onClick={() => setMode("bulk")}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${mode === "bulk" ? "bg-cyan-400 text-cyan-950" : "border border-zinc-700 text-zinc-200"}`}
            >
              Bulk Add
            </button>
            <button
              onClick={() => void refreshServers()}
              disabled={busy}
              className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-emerald-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Refresh
            </button>
            <button
              onClick={async () => {
                await fetch("/api/admin/auth/logout", { method: "POST" });
                window.location.reload();
              }}
              className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold text-zinc-200"
            >
              Lock
            </button>
          </div>
        </div>
      </section>

      {mode === "single" ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-lg shadow-black/25">
          <h3 className="text-lg font-semibold text-zinc-100">Add VPN Server</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Protocol builds as family:variant. Current value: {protocol}
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Server name"
              className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            />
            <input
              value={form.country}
              onChange={(event) => setForm((prev) => ({ ...prev, country: event.target.value }))}
              placeholder="Country"
              className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            />
            <input
              value={form.host}
              onChange={(event) => setForm((prev) => ({ ...prev, host: event.target.value }))}
              placeholder="Host / IP"
              className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            />
            <select
              value={form.family}
              onChange={(event) => setForm((prev) => ({ ...prev, family: event.target.value }))}
              className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            >
              {protocolFamilies.map((family) => (
                <option key={family} value={family}>
                  {family}
                </option>
              ))}
            </select>
            <input
              value={form.variant}
              onChange={(event) => setForm((prev) => ({ ...prev, variant: event.target.value }))}
              placeholder="Variant (vless, vmess, dnstt, tcp...)"
              className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            />
            <input
              value={form.port}
              onChange={(event) => setForm((prev) => ({ ...prev, port: event.target.value }))}
              placeholder="Port"
              className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            />
          </div>
          <textarea
            value={form.rawConfig}
            onChange={(event) => setForm((prev) => ({ ...prev, rawConfig: event.target.value }))}
            placeholder="Raw config / URI / JSON"
            className="mt-3 h-36 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
          />
          <textarea
            value={form.extraJson}
            onChange={(event) => setForm((prev) => ({ ...prev, extraJson: event.target.value }))}
            placeholder='Extra JSON for protocol-specific options, example: {"packetEncoding":"xudp"}'
            className="mt-3 h-28 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
          />
          <div className="mt-4 grid gap-3 text-sm text-zinc-300 md:grid-cols-4">
            {optionItems.map((item) => (
              <label key={item.key} className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2">
                <input
                  type="checkbox"
                  checked={form[item.key]}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, [item.key]: event.target.checked }))
                  }
                />
                {item.label}
              </label>
            ))}
          </div>
          <button
            onClick={() => void submitServer()}
            disabled={busy}
            className="mt-4 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-cyan-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Add and Encrypt
          </button>
          {message ? <p className="mt-3 text-sm text-zinc-300">{message}</p> : null}
        </section>
      ) : (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-lg shadow-black/25">
          <h3 className="text-lg font-semibold text-zinc-100">Bulk Add</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Paste JSON array. Supports protocol or family+variant per item.
          </p>
          <textarea
            value={bulkPayload}
            onChange={(event) => setBulkPayload(event.target.value)}
            className="mt-4 h-72 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-500"
            placeholder={`[
  {
    "name": "Germany VLESS",
    "family": "v2ray",
    "variant": "vless",
    "host": "1.2.3.4",
    "port": 443,
    "country": "Germany",
    "rawConfig": "vless://...",
    "options": {
      "mux": true,
      "fragment": false,
      "sniffing": true,
      "allowInsecure": false,
      "extra": {"security":"reality"}
    }
  },
  {
    "name": "SSH DNS Tunnel",
    "protocol": "ssh:dnstt",
    "host": "8.8.8.8",
    "port": 53,
    "country": "US",
    "rawConfig": "ssh://..."
  }
]`}
          />
          <button
            onClick={() => void submitBulk()}
            disabled={busy || bulkPayload.trim().length === 0}
            className="mt-4 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-cyan-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Import Bulk
          </button>
          {message ? <p className="mt-3 text-sm text-zinc-300">{message}</p> : null}
        </section>
      )}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-lg shadow-black/25">
        <h3 className="text-lg font-semibold text-zinc-100">Stored Servers</h3>
        <div className="mt-4 grid gap-3">
          {servers.map((server) => (
            <div
              key={server.id}
              className="flex flex-col justify-between gap-3 rounded-xl border border-zinc-700 bg-zinc-950/70 p-4 md:flex-row md:items-center"
            >
              <div>
                <p className="text-sm font-semibold text-zinc-100">
                  {server.name} · {server.protocol.toUpperCase()}
                </p>
                <p className="text-xs text-zinc-400">
                  {server.host}:{server.port} · {server.country}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void toggleServer(server.id, !server.isEnabled)}
                  className="rounded-lg border border-zinc-600 px-3 py-2 text-xs text-zinc-100"
                >
                  {server.isEnabled ? "Disable" : "Enable"}
                </button>
                <button
                  onClick={() => void removeServer(server.id)}
                  className="rounded-lg border border-rose-600 px-3 py-2 text-xs text-rose-300"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {servers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-700 p-4 text-sm text-zinc-500">
              No servers yet.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
