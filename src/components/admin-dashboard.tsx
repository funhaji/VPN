"use client";

import { useCallback, useEffect, useState } from "react";
import type { ServerRecord } from "@/types/server";

type TabId = "v2ray" | "ssh" | "openvpn" | "wireguard" | "custom" | "bulk";

type FormState = {
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

const BLANK: FormState = {
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

const PROTOCOLS: { id: TabId; label: string; badge: string }[] = [
  { id: "v2ray", label: "V2Ray", badge: "vless / vmess / trojan / ss / hy" },
  { id: "ssh", label: "SSH", badge: "direct / dnstt / udp" },
  { id: "openvpn", label: "OpenVPN", badge: "tcp / udp" },
  { id: "wireguard", label: "WireGuard", badge: "wg" },
  { id: "custom", label: "Custom", badge: "any protocol string" },
  { id: "bulk", label: "Bulk", badge: "JSON array import" },
];

export function AdminDashboard() {
  const [tab, setTab] = useState<TabId>("v2ray");
  const [form, setForm] = useState<FormState>(BLANK);
  const [variant, setVariant] = useState("vless");
  const [customProto, setCustomProto] = useState("custom:tcp");
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [stats, setStats] = useState({ total: 0, enabled: 0 });

  const protocol = tab === "custom" ? customProto : `${tab}:${variant}`;

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(d.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const d = await api<{ servers: ServerRecord[] }>("/api/admin/servers");
      setServers(d.servers);
      setStats({ total: d.servers.length, enabled: d.servers.filter((s) => s.isEnabled).length });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Load failed" });
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const reset = () => { setForm(BLANK); setVariant("vless"); setCustomProto("custom:tcp"); };

  const submit = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const extra = JSON.parse(form.extraJson || "{}");
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        protocol,
        country: form.country.trim(),
        rawConfig: form.rawConfig.trim(),
        isEnabled: true,
        options: { mux: form.mux, fragment: form.fragment, sniffing: form.sniffing, allowInsecure: form.allowInsecure, extra },
      };
      if (tab !== "v2ray") {
        if (form.host.trim()) payload.host = form.host.trim();
        if (form.port.trim()) payload.port = Number(form.port);
      }
      await api("/api/admin/servers", { method: "POST", body: JSON.stringify(payload) });
      setMsg({ ok: true, text: "Server added" });
      reset();
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }, [api, form, protocol, tab, load]);

  const submitBulk = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const items = JSON.parse(bulk) as Array<{
        name?: unknown;
        protocol?: unknown;
        variant?: unknown;
        country?: unknown;
        rawConfig?: unknown;
        config?: unknown;
        host?: unknown;
        port?: unknown;
        options?: {
          mux?: unknown;
          fragment?: unknown;
          sniffing?: unknown;
          allowInsecure?: unknown;
          extra?: unknown;
        };
        mux?: unknown;
        fragment?: unknown;
        sniffing?: unknown;
        allowInsecure?: unknown;
        extra?: unknown;
      }>;
      if (!Array.isArray(items) || items.length === 0) throw new Error("Must be a non-empty array");
      const servers = items.map((item) => ({
        name: String(item.name ?? "").trim(),
        protocol: String(item.protocol ?? `custom:${item.variant ?? "tcp"}`).toLowerCase(),
        country: String(item.country ?? "").trim(),
        rawConfig: String(item.rawConfig ?? item.config ?? "").trim(),
        isEnabled: true,
        options: {
          mux: Boolean(item.options?.mux ?? item.mux),
          fragment: Boolean(item.options?.fragment ?? item.fragment),
          sniffing: Boolean(item.options?.sniffing ?? item.sniffing ?? true),
          allowInsecure: Boolean(item.options?.allowInsecure ?? item.allowInsecure),
          extra: (item.options?.extra ?? item.extra) ?? {},
        },
        ...(item.host ? { host: item.host } : {}),
        ...(item.port ? { port: Number(item.port) } : {}),
      }));
      await api("/api/admin/servers", { method: "POST", body: JSON.stringify({ servers }) });
      setMsg({ ok: true, text: `Imported ${servers.length} servers` });
      setBulk("");
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Bulk import failed" });
    } finally {
      setBusy(false);
    }
  }, [api, bulk, load]);

  const toggle = useCallback(async (id: string, isEnabled: boolean) => {
    try {
      await api(`/api/admin/servers/${id}`, { method: "PATCH", body: JSON.stringify({ isEnabled }) });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Toggle failed" });
    }
  }, [api, load]);

  const remove = useCallback(async (id: string) => {
    try {
      await api(`/api/admin/servers/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Delete failed" });
    }
  }, [api, load]);

  const logout = async () => {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    window.location.reload();
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">

      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-zinc-800 bg-zinc-900/60">
        <div className="p-5 border-b border-zinc-800">
          <h1 className="text-base font-bold text-zinc-50 tracking-wide">Astro VPN</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Control Panel</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <p className="text-xs font-semibold text-zinc-600 uppercase mt-2 mb-1 px-2">Add Server</p>
          {PROTOCOLS.map((p) => (
            <button
              key={p.id}
              onClick={() => { setTab(p.id); setMsg(null); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                tab === p.id
                  ? "bg-cyan-400 text-cyan-950"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-zinc-800 space-y-1">
          <div className="px-3 py-2 rounded-lg bg-zinc-800/60 text-xs text-zinc-400">
            <span className="font-semibold text-zinc-200">{stats.enabled}</span>/{stats.total} online
          </div>
          <button onClick={() => void load()} className="w-full px-3 py-2 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 text-left">
            ↺ Refresh
          </button>
          <button onClick={logout} className="w-full px-3 py-2 rounded-lg text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 text-left">
            🔒 Lock
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/40">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{PROTOCOLS.find((p) => p.id === tab)?.label} Server</h2>
            <p className="text-xs text-zinc-500 mt-0.5">{PROTOCOLS.find((p) => p.id === tab)?.badge}</p>
          </div>
          <code className="text-xs bg-zinc-800 text-cyan-400 px-2 py-1 rounded font-mono">{protocol}</code>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {tab !== "bulk" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 md:col-span-1">
                  <label className="text-xs text-zinc-500 mb-1 block">Server Name</label>
                  <input
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="Germany Free #1"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="text-xs text-zinc-500 mb-1 block">Country / Label</label>
                  <input
                    value={form.country}
                    onChange={(e) => set("country", e.target.value)}
                    placeholder="Germany"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                {tab !== "v2ray" && (
                  <div className="col-span-2 md:col-span-1">
                    <label className="text-xs text-zinc-500 mb-1 block">Host / IP</label>
                    <input
                      value={form.host}
                      onChange={(e) => set("host", e.target.value)}
                      placeholder="192.168.1.1"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                )}
                {tab !== "v2ray" && (
                  <div className="col-span-2 md:col-span-1">
                    <label className="text-xs text-zinc-500 mb-1 block">Port</label>
                    <input
                      value={form.port}
                      onChange={(e) => set("port", e.target.value)}
                      placeholder="443"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                )}

                <div className="col-span-2">
                  <label className="text-xs text-zinc-500 mb-1 block">
                    {tab === "v2ray" ? "V2Ray URI / JSON" : "Raw Config / URI / JSON"}
                  </label>
                  <textarea
                    value={form.rawConfig}
                    onChange={(e) => set("rawConfig", e.target.value)}
                    rows={4}
                    placeholder={
                      tab === "v2ray"
                        ? "vless://... (full URI or JSON — host/port auto-extracted)"
                        : "Full config URI, JSON, or base64 blob"
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none resize-none font-mono"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-xs text-zinc-500 mb-1 block">Extra Options (JSON)</label>
                  <input
                    value={form.extraJson}
                    onChange={(e) => set("extraJson", e.target.value)}
                    placeholder='{"packetEncoding":"xudp"}'
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none font-mono"
                  />
                </div>

                <div className="col-span-2 flex flex-wrap gap-2">
                  {[
                    { k: "mux", l: "Mux" },
                    { k: "fragment", l: "Fragment" },
                    { k: "sniffing", l: "Sniffing" },
                    { k: "allowInsecure", l: "AllowInsecure" },
                  ].map(({ k, l }) => (
                    <label key={k} className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 cursor-pointer hover:border-zinc-600">
                      <input
                        type="checkbox"
                        checked={form[k as keyof FormState] as boolean}
                        onChange={(e) => set(k as keyof FormState, e.target.checked)}
                        className="accent-cyan-400"
                      />
                      {l}
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={() => void submit()}
                disabled={busy || !form.name.trim() || !form.rawConfig.trim()}
                className="rounded-xl bg-cyan-400 px-6 py-3 text-sm font-bold text-cyan-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40 transition-colors w-full md:w-auto"
              >
                {busy ? "Saving..." : "Add Server"}
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Bulk JSON</label>
                <textarea
                  value={bulk}
                  onChange={(e) => setBulk(e.target.value)}
                  rows={10}
                  placeholder={`[
  {
    "name": "Germany VLESS",
    "protocol": "v2ray:vless",
    "country": "Germany",
    "rawConfig": "vless://...",
    "options": {"mux": true, "sniffing": true}
  },
  {
    "name": "US SSH",
    "protocol": "ssh:direct",
    "host": "1.2.3.4",
    "port": 22,
    "country": "United States",
    "rawConfig": "ssh://..."
  }
]`}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none resize-none font-mono"
                />
              </div>
              <button
                onClick={() => void submitBulk()}
                disabled={busy || !bulk.trim()}
                className="rounded-xl bg-cyan-400 px-6 py-3 text-sm font-bold text-cyan-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40 transition-colors w-full md:w-auto"
              >
                {busy ? "Importing..." : "Import Bulk"}
              </button>
            </>
          )}

          {msg && (
            <div className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? "bg-emerald-900/40 text-emerald-300 border border-emerald-800" : "bg-rose-900/40 text-rose-300 border border-rose-800"}`}>
              {msg.text}
            </div>
          )}

          <div className="border-t border-zinc-800 pt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-zinc-200">Stored Servers ({servers.length})</h3>
            </div>
            <div className="space-y-2">
              {servers.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-100 truncate">{s.name}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {s.protocol.toUpperCase()} · {s.country}
                      {s.host ? ` · ${s.host}:${s.port}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2 ml-3 flex-shrink-0">
                    <button
                      onClick={() => void toggle(s.id, !s.isEnabled)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-colors ${
                        s.isEnabled
                          ? "border-emerald-700 text-emerald-400 hover:bg-emerald-900/30"
                          : "border-zinc-700 text-zinc-500 hover:bg-zinc-800"
                      }`}
                    >
                      {s.isEnabled ? "ON" : "OFF"}
                    </button>
                    <button
                      onClick={() => void remove(s.id)}
                      className="rounded-lg border border-rose-800 px-2.5 py-1.5 text-xs font-semibold text-rose-400 hover:bg-rose-900/30 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              {servers.length === 0 && (
                <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-600">
                  No servers yet — add one from the form above.
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
