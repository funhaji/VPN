"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type DeviceSummary = {
  deviceId: string;
  platform: string;
  appVersion: string;
  osVersion: string;
  model: string;
  firstSeen: string;
  lastSeen: string;
};

export type PlatformAnalytics = {
  platform: string;
  total: number;
  active24h: number;
  active7d: number;
  active30d: number;
  versions: Record<string, number>;
};

export type ClientAnalyticsReport = {
  platforms: Record<string, PlatformAnalytics>;
  totalAll: number;
  active24hAll: number;
  recentDevices: DeviceSummary[];
  updatedAt: string;
};

function formatRelativeTime(dateString: string): string {
  try {
    const then = new Date(dateString).getTime();
    if (!Number.isFinite(then)) return "Unknown";
    const now = Date.now();
    const diffSec = Math.max(0, Math.floor((now - then) / 1000));

    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
  } catch {
    return dateString;
  }
}

export function ActiveUsersPanel({
  api,
  busy,
  setBusy,
  setMsg,
}: {
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setMsg: (msg: { ok: boolean; text: string } | null) => void;
}) {
  const [loadFailed, setLoadFailed] = useState(false);
  const [report, setReport] = useState<ClientAnalyticsReport | null>(null);
  const [platformFilter, setPlatformFilter] = useState<"all" | "windows" | "android">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setBusy(true);
    setLoadFailed(false);
    try {
      const data = await api<ClientAnalyticsReport>("/api/admin/users");
      setReport(data);
    } catch {
      setLoadFailed(true);
      setMsg({ ok: false, text: "Failed to load user analytics" });
    } finally {
      setBusy(false);
    }
  }, [api, setBusy, setMsg]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const copyDeviceId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { setMsg({ ok: false, text: "Could not copy device ID" }); }
  };

  const winStats = report?.platforms?.windows ?? {
    platform: "windows",
    total: 0,
    active24h: 0,
    active7d: 0,
    active30d: 0,
    versions: {},
  };

  const androidStats = report?.platforms?.android ?? {
    platform: "android",
    total: 0,
    active24h: 0,
    active7d: 0,
    active30d: 0,
    versions: {},
  };

  const devices = report?.recentDevices ?? [];

  const filteredDevices = useMemo(() => {
    return devices.filter((d) => {
      const p = d.platform.toLowerCase();
      if (platformFilter === "windows" && p !== "windows") return false;
      if (platformFilter === "android" && p !== "android") return false;
      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase();
      return (
        d.deviceId.toLowerCase().includes(q) ||
        d.model.toLowerCase().includes(q) ||
        d.osVersion.toLowerCase().includes(q) ||
        d.appVersion.toLowerCase().includes(q)
      );
    });
  }, [devices, platformFilter, searchQuery]);

  return (
    <div className="space-y-6 max-w-full min-w-0">
      {/* Header bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-white/6 bg-white/2 p-4">
        <div>
          <h4 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
            <span>User Telemetry & Activity</span>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </h4>
          <p className="mt-0.5 text-xs text-zinc-400">
            Real hardware-deduplicated client devices. First launch tracks unique installs; daily launches update active metrics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {report?.updatedAt && (
            <span className="text-[11px] font-mono text-zinc-500">
              Updated {formatRelativeTime(report.updatedAt)}
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 disabled:opacity-40"
          >
            <span>{busy ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {!report ? (
        <div role="status" className="rounded-2xl border border-white/10 bg-zinc-950/70 p-8 text-center text-sm text-zinc-400">
          {loadFailed ? "Analytics are unavailable. Use Refresh to try again." : "Loading analytics…"}
        </div>
      ) : <>
      {/* 4 Overview KPI Cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-white/6 bg-zinc-950/70 p-4">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">Total Unique Users</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-cyan-400">
              {report?.totalAll ?? 0}
            </span>
            <span className="text-xs text-zinc-500">devices</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="text-blue-400">Win: {winStats.total}</span>
            <span>•</span>
            <span className="text-emerald-400">Android: {androidStats.total}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-white/6 bg-zinc-950/70 p-4">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">Daily Active (24h)</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-emerald-400">
              {report?.active24hAll ?? 0}
            </span>
            <span className="text-xs text-zinc-500">today</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="text-blue-400">Win: {winStats.active24h}</span>
            <span>•</span>
            <span className="text-emerald-400">Android: {androidStats.active24h}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-white/6 bg-zinc-950/70 p-4">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">Weekly Active (7d)</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-cyan-300">
              {(winStats.active7d || 0) + (androidStats.active7d || 0)}
            </span>
            <span className="text-xs text-zinc-500">this week</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="text-blue-400">Win: {winStats.active7d}</span>
            <span>•</span>
            <span className="text-emerald-400">Android: {androidStats.active7d}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-white/6 bg-zinc-950/70 p-4">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">Monthly Active (30d)</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-purple-300">
              {(winStats.active30d || 0) + (androidStats.active30d || 0)}
            </span>
            <span className="text-xs text-zinc-500">this month</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="text-blue-400">Win: {winStats.active30d}</span>
            <span>•</span>
            <span className="text-emerald-400">Android: {androidStats.active30d}</span>
          </div>
        </div>
      </div>

      {/* Platform Deep-Dive Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Windows Card */}
        <div className="rounded-2xl border border-blue-500/20 bg-blue-950/10 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-xs">
                WIN
              </div>
              <div>
                <h5 className="text-sm font-semibold text-zinc-100">Windows Clients</h5>
                <p className="text-[11px] text-zinc-400">MachineGuid + SMBIOS UUID hardware-bound</p>
              </div>
            </div>
            <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-mono font-bold text-blue-300">
              {winStats.total} total
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5 text-center">
            <div className="rounded-xl bg-black/20 p-2">
              <p className="text-[10px] uppercase text-zinc-500">24h Active</p>
              <p className="text-sm font-bold font-mono text-emerald-400">{winStats.active24h}</p>
            </div>
            <div className="rounded-xl bg-black/20 p-2">
              <p className="text-[10px] uppercase text-zinc-500">7d Active</p>
              <p className="text-sm font-bold font-mono text-cyan-300">{winStats.active7d}</p>
            </div>
            <div className="rounded-xl bg-black/20 p-2">
              <p className="text-[10px] uppercase text-zinc-500">30d Active</p>
              <p className="text-sm font-bold font-mono text-purple-300">{winStats.active30d}</p>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-medium text-zinc-400 mb-1.5">Version Distribution:</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(winStats.versions || {}).length > 0 ? (
                Object.entries(winStats.versions).map(([ver, count]) => (
                  <span key={ver} className="rounded-lg bg-white/5 px-2 py-0.5 text-xs font-mono text-zinc-300">
                    v{ver}: <strong className="text-blue-300">{count}</strong>
                  </span>
                ))
              ) : (
                <span className="text-xs text-zinc-500">No telemetry recorded yet</span>
              )}
            </div>
          </div>
        </div>

        {/* Android Card */}
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-xs">
                AND
              </div>
              <div>
                <h5 className="text-sm font-semibold text-zinc-100">Android Clients</h5>
                <p className="text-[11px] text-zinc-400">Android ID + Curve25519 device keystore</p>
              </div>
            </div>
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-300">
              {androidStats.total} total
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5 text-center">
            <div className="rounded-xl bg-black/20 p-2">
              <p className="text-[10px] uppercase text-zinc-500">24h Active</p>
              <p className="text-sm font-bold font-mono text-emerald-400">{androidStats.active24h}</p>
            </div>
            <div className="rounded-xl bg-black/20 p-2">
              <p className="text-[10px] uppercase text-zinc-500">7d Active</p>
              <p className="text-sm font-bold font-mono text-cyan-300">{androidStats.active7d}</p>
            </div>
            <div className="rounded-xl bg-black/20 p-2">
              <p className="text-[10px] uppercase text-zinc-500">30d Active</p>
              <p className="text-sm font-bold font-mono text-purple-300">{androidStats.active30d}</p>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-medium text-zinc-400 mb-1.5">Version Distribution:</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(androidStats.versions || {}).length > 0 ? (
                Object.entries(androidStats.versions).map(([ver, count]) => (
                  <span key={ver} className="rounded-lg bg-white/5 px-2 py-0.5 text-xs font-mono text-zinc-300">
                    v{ver}: <strong className="text-emerald-300">{count}</strong>
                  </span>
                ))
              ) : (
                <span className="text-xs text-zinc-500">No telemetry recorded yet</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Live Devices Stream */}
      <div className="rounded-2xl border border-zinc-900 bg-zinc-950/70 p-4 sm:p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPlatformFilter("all")}
              aria-pressed={platformFilter === "all"}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                platformFilter === "all"
                  ? "bg-cyan-400 text-cyan-950"
                  : "bg-white/5 text-zinc-400 hover:bg-white/10"
              }`}
            >
              All Devices ({devices.length})
            </button>
            <button
              type="button"
              onClick={() => setPlatformFilter("windows")}
              aria-pressed={platformFilter === "windows"}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                platformFilter === "windows"
                  ? "bg-blue-500 text-white"
                  : "bg-white/5 text-zinc-400 hover:bg-white/10"
              }`}
            >
              Windows ({devices.filter((d) => d.platform.toLowerCase() === "windows").length})
            </button>
            <button
              type="button"
              onClick={() => setPlatformFilter("android")}
              aria-pressed={platformFilter === "android"}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                platformFilter === "android"
                  ? "bg-emerald-500 text-white"
                  : "bg-white/5 text-zinc-400 hover:bg-white/10"
              }`}
            >
              Android ({devices.filter((d) => d.platform.toLowerCase() === "android").length})
            </button>
          </div>

          <div className="w-full sm:w-64">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search devices"
              placeholder="Search by ID, model, OS..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Devices List */}
        <div className="overflow-x-auto">
          {filteredDevices.length > 0 ? (
            <table className="w-full text-left text-xs text-zinc-300">
              <thead className="border-b border-white/5 text-[10px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="py-2.5 px-3">Device / HWID</th>
                  <th className="py-2.5 px-3">Platform</th>
                  <th className="py-2.5 px-3">App Ver</th>
                  <th className="py-2.5 px-3">Hardware / OS</th>
                  <th className="py-2.5 px-3">First Seen</th>
                  <th className="py-2.5 px-3 text-right">Last Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {filteredDevices.map((d) => {
                  const isRecent = Date.now() - new Date(d.lastSeen).getTime() < 24 * 60 * 60 * 1000;
                  const isWindows = d.platform.toLowerCase() === "windows";
                  return (
                    <tr key={d.deviceId} className="hover:bg-white/2 transition">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              isRecent ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" : "bg-zinc-600"
                            }`}
                            title={isRecent ? "Active today" : "Offline / inactive"}
                          />
                          <button
                            type="button"
                            onClick={() => copyDeviceId(d.deviceId)}
                            className="font-mono text-zinc-200 hover:text-cyan-400 transition flex items-center gap-1 group text-left"
                            title="Click to copy full device ID"
                          >
                            <span>{d.deviceId.slice(0, 16)}...</span>
                            <span className="text-[10px] text-zinc-600 group-hover:text-cyan-400">
                              {copiedId === d.deviceId ? "✓" : "📋"}
                            </span>
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            isWindows ? "bg-blue-500/15 text-blue-300" : "bg-emerald-500/15 text-emerald-300"
                          }`}
                        >
                          {d.platform}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-zinc-300 font-semibold">
                        v{d.appVersion}
                      </td>
                      <td className="py-3 px-3 font-sans text-zinc-400 truncate max-w-[200px]" title={`${d.model} ${d.osVersion}`}>
                        {d.model || d.osVersion ? `${d.model} ${d.osVersion}`.trim() : "Standard PC"}
                      </td>
                      <td className="py-3 px-3 text-zinc-500 text-[11px]">
                        {formatRelativeTime(d.firstSeen)}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className={`text-[11px] font-semibold ${isRecent ? "text-emerald-400" : "text-zinc-500"}`}>
                          {formatRelativeTime(d.lastSeen)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="py-12 text-center text-xs text-zinc-500">
              No devices match the current filter.
            </div>
          )}
        </div>
      </div>
      </>}
    </div>
  );
}
