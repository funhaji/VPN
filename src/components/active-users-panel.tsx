"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  /** Number of devices matching the current filter (may exceed recentDevices.length). */
  deviceMatches?: number;
  updatedAt: string;
};

type PlatformFilter = "all" | "windows" | "android";

const PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const emptyStats = (platform: string): PlatformAnalytics => ({
  platform,
  total: 0,
  active24h: 0,
  active7d: 0,
  active30d: 0,
  versions: {},
});

function formatRelativeTime(dateString: string): string {
  const then = new Date(dateString).getTime();
  if (!Number.isFinite(then)) return "Unknown";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function KpiCard({
  label,
  value,
  unit,
  tone,
  win,
  android,
}: {
  label: string;
  value: number;
  unit: string;
  tone: string;
  win: number;
  android: number;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-zinc-950/70 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className={`font-mono text-xl font-bold ${tone}`}>{value}</span>
        <span className="text-[11px] text-zinc-500">{unit}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-400">
        <span className="text-blue-400">Win {win}</span>
        <span className="text-zinc-700">•</span>
        <span className="text-emerald-400">Android {android}</span>
      </div>
    </div>
  );
}

function PlatformCard({
  stats,
  title,
  subtitle,
  badge,
  accent,
}: {
  stats: PlatformAnalytics;
  title: string;
  subtitle: string;
  badge: string;
  accent: "blue" | "emerald";
}) {
  const palette =
    accent === "blue"
      ? { border: "border-blue-500/20 bg-blue-950/10", chip: "bg-blue-500/20 text-blue-400", pill: "bg-blue-500/15 text-blue-300", strong: "text-blue-300" }
      : { border: "border-emerald-500/20 bg-emerald-950/10", chip: "bg-emerald-500/20 text-emerald-400", pill: "bg-emerald-500/15 text-emerald-300", strong: "text-emerald-300" };
  const versions = Object.entries(stats.versions || {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className={`space-y-2.5 rounded-xl border p-3 ${palette.border}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${palette.chip}`}>{badge}</div>
          <div className="min-w-0">
            <h5 className="text-sm font-semibold text-zinc-100">{title}</h5>
            <p className="truncate text-[10px] text-zinc-500">{subtitle}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] font-bold ${palette.pill}`}>{stats.total} total</span>
      </div>

      <div className="grid grid-cols-3 gap-1.5 text-center">
        {(
          [
            ["24h", stats.active24h, "text-emerald-400"],
            ["7d", stats.active7d, "text-cyan-300"],
            ["30d", stats.active30d, "text-purple-300"],
          ] as const
        ).map(([label, value, tone]) => (
          <div key={label} className="rounded-lg bg-black/20 px-2 py-1.5">
            <p className="text-[9px] uppercase text-zinc-500">{label} active</p>
            <p className={`font-mono text-sm font-bold ${tone}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-0.5 text-[10px] text-zinc-500">Versions:</span>
        {versions.length > 0 ? (
          versions.map(([ver, count]) => (
            <span key={ver} className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
              v{ver} <strong className={palette.strong}>{count}</strong>
            </span>
          ))
        ) : (
          <span className="text-[11px] text-zinc-500">No telemetry yet</span>
        )}
      </div>
    </div>
  );
}

export function ActiveUsersPanel({
  api,
  setMsg,
}: {
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
  setMsg: (msg: { ok: boolean; text: string } | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [report, setReport] = useState<ClientAnalyticsReport | null>(null);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset paging whenever the filter changes.
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [platformFilter, debouncedQuery]);

  const loadData = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadFailed(false);
    const params = new URLSearchParams({ limit: String(limit) });
    if (platformFilter !== "all") params.set("platform", platformFilter);
    if (debouncedQuery) params.set("q", debouncedQuery);
    try {
      const data = await api<ClientAnalyticsReport>(`/api/admin/users?${params.toString()}`);
      if (seq === requestSeq.current) setReport(data);
    } catch {
      if (seq === requestSeq.current) {
        setLoadFailed(true);
        setMsg({ ok: false, text: "Failed to load user analytics" });
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [api, setMsg, limit, platformFilter, debouncedQuery]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const copyDeviceId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setMsg({ ok: false, text: "Could not copy device ID" });
    }
  };

  const winStats = report?.platforms?.windows ?? emptyStats("windows");
  const androidStats = report?.platforms?.android ?? emptyStats("android");
  const devices = report?.recentDevices ?? [];
  const matches = report?.deviceMatches ?? devices.length;
  const hasMore = devices.length < matches;
  const now = Date.now();

  const filterTabs: { key: PlatformFilter; label: string; count: number; active: string }[] = [
    { key: "all", label: "All", count: report?.totalAll ?? 0, active: "bg-cyan-400 text-cyan-950" },
    { key: "windows", label: "Windows", count: winStats.total, active: "bg-blue-500 text-white" },
    { key: "android", label: "Android", count: androidStats.total, active: "bg-emerald-500 text-white" },
  ];

  return (
    <div className="min-w-0 max-w-full space-y-3">
      {/* Header bar */}
      <div className="flex flex-col gap-2 rounded-xl border border-white/6 bg-white/2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <span>User Telemetry & Activity</span>
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          </h4>
          <p className="text-[11px] text-zinc-500">Hardware-deduplicated devices. First launch counts an install; daily launches update activity.</p>
        </div>
        <div className="flex items-center gap-2">
          {report?.updatedAt && <span className="font-mono text-[10px] text-zinc-500">Updated {formatRelativeTime(report.updatedAt)}</span>}
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 disabled:opacity-40"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {!report ? (
        <div role="status" className="rounded-xl border border-white/10 bg-zinc-950/70 p-6 text-center text-sm text-zinc-400">
          {loadFailed ? "Analytics are unavailable. Use Refresh to try again." : "Loading analytics…"}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <KpiCard label="Total unique users" value={report.totalAll ?? 0} unit="devices" tone="text-cyan-400" win={winStats.total} android={androidStats.total} />
            <KpiCard label="Daily active (24h)" value={report.active24hAll ?? 0} unit="today" tone="text-emerald-400" win={winStats.active24h} android={androidStats.active24h} />
            <KpiCard
              label="Weekly active (7d)"
              value={(winStats.active7d || 0) + (androidStats.active7d || 0)}
              unit="this week"
              tone="text-cyan-300"
              win={winStats.active7d}
              android={androidStats.active7d}
            />
            <KpiCard
              label="Monthly active (30d)"
              value={(winStats.active30d || 0) + (androidStats.active30d || 0)}
              unit="this month"
              tone="text-purple-300"
              win={winStats.active30d}
              android={androidStats.active30d}
            />
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <PlatformCard stats={winStats} title="Windows Clients" subtitle="MachineGuid + SMBIOS UUID hardware-bound" badge="WIN" accent="blue" />
            <PlatformCard stats={androidStats} title="Android Clients" subtitle="Android ID + Curve25519 device keystore" badge="AND" accent="emerald" />
          </div>

          {/* Devices */}
          <div className="space-y-2 rounded-xl border border-zinc-900 bg-zinc-950/70 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-1">
                {filterTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setPlatformFilter(tab.key)}
                    aria-pressed={platformFilter === tab.key}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      platformFilter === tab.key ? tab.active : "bg-white/5 text-zinc-400 hover:bg-white/10"
                    }`}
                  >
                    {tab.label} <span className="opacity-70">{tab.count}</span>
                  </button>
                ))}
              </div>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search devices"
                placeholder="Search ID, model, OS, version…"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none sm:w-64"
              />
            </div>

            <p className="text-[10px] text-zinc-500" aria-live="polite">
              {loading ? "Loading…" : `Showing ${devices.length} of ${matches} device${matches === 1 ? "" : "s"}, most recently active first`}
            </p>

            <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
              {devices.length > 0 ? (
                <table className="w-full text-left text-xs text-zinc-300">
                  <thead className="border-b border-white/5 text-[10px] uppercase tracking-wider text-zinc-500">
                    <tr>
                      <th className="px-2 py-1.5">Device / HWID</th>
                      <th className="px-2 py-1.5">Platform</th>
                      <th className="px-2 py-1.5">App</th>
                      <th className="px-2 py-1.5">Hardware / OS</th>
                      <th className="px-2 py-1.5">First seen</th>
                      <th className="px-2 py-1.5 text-right">Last active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-mono">
                    {devices.map((d) => {
                      const isRecent = now - new Date(d.lastSeen).getTime() < DAY_MS;
                      const isWindows = d.platform.toLowerCase() === "windows";
                      return (
                        <tr key={d.deviceId} className="transition hover:bg-white/2">
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${isRecent ? "bg-emerald-400" : "bg-zinc-600"}`}
                                title={isRecent ? "Active today" : "Inactive"}
                              />
                              <button
                                type="button"
                                onClick={() => void copyDeviceId(d.deviceId)}
                                className="group flex items-center gap-1 text-left text-zinc-200 transition hover:text-cyan-400"
                                title="Copy full device ID"
                              >
                                <span>{d.deviceId.slice(0, 16)}…</span>
                                <span className="text-[10px] text-zinc-600 group-hover:text-cyan-400">{copiedId === d.deviceId ? "✓" : "⧉"}</span>
                              </button>
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                isWindows ? "bg-blue-500/15 text-blue-300" : "bg-emerald-500/15 text-emerald-300"
                              }`}
                            >
                              {d.platform}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 font-semibold text-zinc-300">v{d.appVersion}</td>
                          <td className="max-w-[200px] truncate px-2 py-1.5 font-sans text-zinc-400" title={`${d.model} ${d.osVersion}`}>
                            {d.model || d.osVersion ? `${d.model} ${d.osVersion}`.trim() : "Standard PC"}
                          </td>
                          <td className="px-2 py-1.5 text-[11px] text-zinc-500">{formatRelativeTime(d.firstSeen)}</td>
                          <td className="px-2 py-1.5 text-right">
                            <span className={`text-[11px] font-semibold ${isRecent ? "text-emerald-400" : "text-zinc-500"}`}>{formatRelativeTime(d.lastSeen)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="py-8 text-center text-xs text-zinc-500">{loading ? "Loading devices…" : "No devices match the current filter."}</div>
              )}
            </div>

            {hasMore && (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => setLimit((value) => Math.min(1000, value + PAGE_SIZE * 2))}
                  disabled={loading || limit >= 1000}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 disabled:opacity-40"
                >
                  {limit >= 1000 ? "Refine the search to see more" : `Load more (${matches - devices.length} remaining)`}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
