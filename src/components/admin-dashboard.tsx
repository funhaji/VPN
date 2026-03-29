"use client";

import { useCallback, useMemo, useState } from "react";
import type { ServerRecord } from "@/types/server";

type FormState = {
  name: string;
  protocol: string;
  host: string;
  port: string;
  country: string;
  rawConfig: string;
  mux: boolean;
  fragment: boolean;
  sniffing: boolean;
  allowInsecure: boolean;
};

const baseForm: FormState = {
  name: "",
  protocol: "vless",
  host: "",
  port: "443",
  country: "",
  rawConfig: "",
  mux: false,
  fragment: false,
  sniffing: true,
  allowInsecure: false,
};

const protocolPresets = [
  "vless",
  "vmess",
  "shadowsocks",
  "hysteria2",
  "trojan",
  "socks",
  "ssh-direct",
  "ssh-dnstt",
  "openvpn",
  "wireguard",
];

const optionItems: Array<{ key: "mux" | "fragment" | "sniffing" | "allowInsecure"; label: string }> = [
  { key: "mux", label: "Mux" },
  { key: "fragment", label: "Fragment" },
  { key: "sniffing", label: "Sniffing" },
  { key: "allowInsecure", label: "AllowInsecure" },
];

export function AdminDashboard() {
  const [adminPass, setAdminPass] = useState("");
  const [form, setForm] = useState<FormState>(baseForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [servers, setServers] = useState<ServerRecord[]>([]);

  const ready = useMemo(() => adminPass.trim().length > 0, [adminPass]);

  const apiCall = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "x-admin-pass": adminPass,
          ...(init?.headers ?? {}),
        },
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Request failed");
      }
      return (await response.json()) as T;
    },
    [adminPass],
  );

  const refreshServers = useCallback(async () => {
    if (!ready) {
      return;
    }
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
  }, [apiCall, ready]);

  const submitServer = useCallback(async () => {
    if (!ready) {
      setMessage("Enter PASS first");
      return;
    }
    setBusy(true);
    try {
      await apiCall<{ ok: boolean }>("/api/admin/servers", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          protocol: form.protocol.trim(),
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
            extra: {},
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
  }, [apiCall, form, ready, refreshServers]);

  const toggleServer = useCallback(
    async (id: string, isEnabled: boolean) => {
      if (!ready) {
        return;
      }
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
    [apiCall, ready, refreshServers],
  );

  const removeServer = useCallback(
    async (id: string) => {
      if (!ready) {
        return;
      }
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
    [apiCall, ready, refreshServers],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 md:px-8">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-lg shadow-black/25">
        <h2 className="text-xl font-semibold text-zinc-50">Astro VPN Server Control</h2>
        <p className="mt-1 text-sm text-zinc-400">Telegram: AstroVPN_Official</p>
        <div className="mt-5 flex flex-col gap-3 md:flex-row">
          <input
            value={adminPass}
            onChange={(event) => setAdminPass(event.target.value)}
            type="password"
            placeholder="PASS from Vercel env"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
          />
          <button
            onClick={() => void refreshServers()}
            disabled={busy || !ready}
            className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-emerald-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Refresh
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-lg shadow-black/25">
        <h3 className="text-lg font-semibold text-zinc-100">Add VPN Server</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
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
          <input
            value={form.port}
            onChange={(event) => setForm((prev) => ({ ...prev, port: event.target.value }))}
            placeholder="Port"
            className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
          />
          <input
            value={form.protocol}
            onChange={(event) => setForm((prev) => ({ ...prev, protocol: event.target.value }))}
            list="protocols"
            placeholder="Protocol"
            className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
          />
          <datalist id="protocols">
            {protocolPresets.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </div>
        <textarea
          value={form.rawConfig}
          onChange={(event) => setForm((prev) => ({ ...prev, rawConfig: event.target.value }))}
          placeholder="Raw config / URI / JSON"
          className="mt-3 h-36 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
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
