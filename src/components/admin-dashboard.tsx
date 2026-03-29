"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ServerRecord } from "@/types/server";

type TabId = "v2ray" | "ssh" | "openvpn" | "wireguard" | "custom" | "bulk";

type BaseState = {
  name: string;
  country: string;
  rawConfig: string;
  host: string;
  port: string;
  extraJson: string;
  mux: boolean;
  fragment: boolean;
  sniffing: boolean;
  allowInsecure: boolean;
};

const defaultState: BaseState = {
  name: "",
  country: "",
  rawConfig: "",
  host: "",
  port: "",
  extraJson: "{}",
  mux: false,
  fragment: false,
  sniffing: true,
  allowInsecure: false,
};

const tabList: Array<{ id: TabId; label: string }> = [
  { id: "v2ray", label: "V2Ray" },
  { id: "ssh", label: "SSH" },
  { id: "openvpn", label: "OpenVPN" },
  { id: "wireguard", label: "WireGuard" },
  { id: "custom", label: "Custom" },
  { id: "bulk", label: "Bulk Add" },
];

export function AdminDashboard() {
  const [tab, setTab] = useState<TabId>("v2ray");
  const [state, setState] = useState<BaseState>(defaultState);
  const [variant, setVariant] = useState("vless");
  const [bulkPayload, setBulkPayload] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [customProtocol, setCustomProtocol] = useState("custom:tcp");
  const protocol = useMemo(() => (tab === "custom" ? customProtocol : `${tab}:${variant}`), [tab, variant, customProtocol]);

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

  const resetForm = () => {
    setState(defaultState);
    setVariant("vless");
    setCustomProtocol("custom:tcp");
  };

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

  useEffect(() => {
    void refreshServers();
  }, [refreshServers]);

  const submitServer = useCallback(async () => {
    setBusy(true);
    try {
      const extra = JSON.parse(state.extraJson) as Record<string, string | number | boolean>;
      await apiCall<{ ok: boolean }>("/api/admin/servers", {
        method: "POST",
        body: JSON.stringify({
          name: state.name.trim(),
          protocol,
          host: tab === "v2ray" ? undefined : state.host.trim() || undefined,
          port: tab === "v2ray" ? undefined : (state.port.trim() ? Number(state.port) : undefined),
          country: state.country.trim(),
          rawConfig: state.rawConfig.trim(),
          isEnabled: true,
          options: {
            mux: state.mux,
            fragment: state.fragment,
            sniffing: state.sniffing,
            allowInsecure: state.allowInsecure,
            extra,
          },
        }),
      });
      resetForm();
      setMessage("Server created");
      await refreshServers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }, [apiCall, protocol, refreshServers, state, tab]);

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
        host: item.host ?? undefined,
        port: item.port ? Number(item.port) : undefined,
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
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-lg shadow-black/25">
        <div className="flex flex-wrap items-center justify-between gap-3 md:flex-nowrap">
          <div>
            <h2 className="text-xl font-semibold text-zinc-50">Astro VPN Server Control</h2>
            <p className="mt-1 text-sm text-zinc-400">Telegram: AstroVPN_Official</p>
          </div>
          <div className="flex gap-2">
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

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-lg shadow-black/25">
        <div className="flex flex-wrap gap-2">
          {tabList.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${tab === item.id ? "bg-cyan-400 text-cyan-950" : "border border-zinc-700 text-zinc-200"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab !== "bulk" ? (
          <>
            <h3 className="mt-5 text-lg font-semibold text-zinc-100">Add {tab.toUpperCase()} Server</h3>
            <p className="mt-1 text-xs text-zinc-500">Protocol value: {protocol}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <input
                value={state.name}
                onChange={(event) => setState((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Server name"
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
              />
              <input
                value={state.country}
                onChange={(event) => setState((prev) => ({ ...prev, country: event.target.value }))}
                placeholder="Country"
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
              />
              {tab === "custom" ? (
                <input
                  value={customProtocol}
                  onChange={(event) => setCustomProtocol(event.target.value)}
                  placeholder="custom:proto"
                  className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                />
              ) : (
                <input
                  value={variant}
                  onChange={(event) => setVariant(event.target.value)}
                  placeholder="Variant (vless, vmess, dnstt...)"
                  className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                />
              )}
            </div>

            {tab !== "v2ray" ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <input
                  value={state.host}
                  onChange={(event) => setState((prev) => ({ ...prev, host: event.target.value }))}
                  placeholder="Host / IP"
                  className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                />
                <input
                  value={state.port}
                  onChange={(event) => setState((prev) => ({ ...prev, port: event.target.value }))}
                  placeholder="Port"
                  className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                />
              </div>
            ) : null}

            <textarea
              value={state.rawConfig}
              onChange={(event) => setState((prev) => ({ ...prev, rawConfig: event.target.value }))}
              placeholder={tab === "v2ray" ? "Paste full V2Ray URI/JSON (host/port auto-extracted)" : "Raw config / URI / JSON"}
              className="mt-3 h-36 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            />
            <textarea
              value={state.extraJson}
              onChange={(event) => setState((prev) => ({ ...prev, extraJson: event.target.value }))}
              placeholder='Extra JSON for this protocol, example: {"packetEncoding":"xudp"}'
              className="mt-3 h-24 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            />
            <div className="mt-4 grid gap-3 text-sm text-zinc-300 md:grid-cols-4">
              {[
                { key: "mux", label: "Mux" },
                { key: "fragment", label: "Fragment" },
                { key: "sniffing", label: "Sniffing" },
                { key: "allowInsecure", label: "AllowInsecure" },
              ].map((item) => (
                <label key={item.key} className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={state[item.key as keyof BaseState] as boolean}
                    onChange={(event) => setState((prev) => ({ ...prev, [item.key]: event.target.checked }))}
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
          </>
        ) : (
          <>
            <h3 className="mt-5 text-lg font-semibold text-zinc-100">Bulk Add</h3>
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
    "country": "Germany",
    "rawConfig": "vless://...",
    "options": {"mux": true}
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
          </>
        )}
      </section>

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
