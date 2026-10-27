"use client";

import { useState } from "react";
import type { SyncEntityOptions } from "@/lib/db";

export type DbStatus = {
  neon: { configured: boolean; healthy: boolean; serverCount: number | null; error: string | null };
  supabase: { configured: boolean; healthy: boolean; serverCount: number | null; error: string | null };
};

type PresetKey = "user-merge-supabase-servers" | "two-way-all" | "supabase-to-neon" | "neon-to-supabase" | "custom";

interface DbSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  dbStatus: DbStatus | null;
  onSuccess: () => Promise<void>;
  api: <T>(url: string, init?: RequestInit) => Promise<T>;
}

export function DbSyncModal({ isOpen, onClose, dbStatus, onSuccess, api }: DbSyncModalProps) {
  const [preset, setPreset] = useState<PresetKey>("user-merge-supabase-servers");
  const [syncServers, setSyncServers] = useState(true);
  const [serversDirection, setServersDirection] = useState<"supabase-to-neon" | "neon-to-supabase" | "two-way">("supabase-to-neon");
  const [serversStrategy, setServersStrategy] = useState<"overwrite" | "keep-target">("overwrite");

  const [syncUsers, setSyncUsers] = useState(true);
  const [usersStrategy, setUsersStrategy] = useState<"two-way-merge" | "supabase-to-neon" | "neon-to-supabase">("two-way-merge");

  const [syncRules, setSyncRules] = useState(true);
  const [rulesStrategy, setRulesStrategy] = useState<"two-way-merge" | "supabase-to-neon" | "neon-to-supabase">("two-way-merge");

  const [syncSettings, setSyncSettings] = useState(true);
  const [settingsDirection, setSettingsDirection] = useState<"supabase-to-neon" | "neon-to-supabase">("supabase-to-neon");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    error?: string;
    source?: string;
    target?: string;
    synced?: { servers: number; routingRules: number; settings: number; devices: number; details: string[] };
  } | null>(null);

  if (!isOpen) return null;

  const handlePresetChange = (p: PresetKey) => {
    setPreset(p);
    if (p === "user-merge-supabase-servers") {
      setSyncServers(true);
      setServersDirection("supabase-to-neon");
      setServersStrategy("overwrite");
      setSyncUsers(true);
      setUsersStrategy("two-way-merge");
      setSyncRules(true);
      setRulesStrategy("two-way-merge");
      setSyncSettings(true);
      setSettingsDirection("supabase-to-neon");
    } else if (p === "two-way-all") {
      setSyncServers(true);
      setServersDirection("two-way");
      setServersStrategy("overwrite");
      setSyncUsers(true);
      setUsersStrategy("two-way-merge");
      setSyncRules(true);
      setRulesStrategy("two-way-merge");
      setSyncSettings(true);
      setSettingsDirection("supabase-to-neon");
    } else if (p === "supabase-to-neon") {
      setSyncServers(true);
      setServersDirection("supabase-to-neon");
      setServersStrategy("overwrite");
      setSyncUsers(true);
      setUsersStrategy("supabase-to-neon");
      setSyncRules(true);
      setRulesStrategy("supabase-to-neon");
      setSyncSettings(true);
      setSettingsDirection("supabase-to-neon");
    } else if (p === "neon-to-supabase") {
      setSyncServers(true);
      setServersDirection("neon-to-supabase");
      setServersStrategy("overwrite");
      setSyncUsers(true);
      setUsersStrategy("neon-to-supabase");
      setSyncRules(true);
      setRulesStrategy("neon-to-supabase");
      setSyncSettings(true);
      setSettingsDirection("neon-to-supabase");
    }
  };

  const handleExecuteSync = async () => {
    setLoading(true);
    setResult(null);

    const options: SyncEntityOptions = {
      servers: {
        enabled: syncServers,
        direction: serversDirection,
        strategy: serversStrategy,
      },
      users: {
        enabled: syncUsers,
        strategy: usersStrategy,
      },
      routingRules: {
        enabled: syncRules,
        strategy: rulesStrategy,
      },
      settings: {
        enabled: syncSettings,
        direction: settingsDirection,
      },
    };

    const source = serversDirection === "neon-to-supabase" ? "neon" : "supabase";
    const target = source === "supabase" ? "neon" : "supabase";

    try {
      const res = await api<{
        ok: boolean;
        source: string;
        target: string;
        synced: { servers: number; routingRules: number; settings: number; devices: number; details: string[] };
      }>("/api/admin/db-sync", {
        method: "POST",
        body: JSON.stringify({ source, target, options }),
      });

      setResult({
        ok: true,
        source: res.source,
        target: res.target,
        synced: res.synced,
      });

      await onSuccess();
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  const isNeonQuota = dbStatus?.neon?.error?.includes("402") || dbStatus?.neon?.error?.includes("quota");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl text-zinc-100 space-y-6">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-4">
          <div>
            <h2 className="text-lg font-semibold tracking-wide text-zinc-100 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-violet-400" />
              Database Sync & Merge Center
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Selectively sync servers, merge active user telemetry, and push configurations across databases.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 rounded-lg p-1.5 hover:bg-white/5 transition"
          >
            ✕
          </button>
        </div>

        {/* Database Status Pills */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl border border-white/8 bg-white/[0.02] space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${!dbStatus?.neon?.configured ? "bg-zinc-600" : dbStatus?.neon?.healthy ? "bg-emerald-400" : "bg-rose-500"}`} />
                Neon Postgres
              </span>
              <span className="font-mono text-[11px] text-zinc-400">
                {!dbStatus?.neon?.configured ? "Not configured" : dbStatus?.neon?.healthy ? `${dbStatus.neon.serverCount ?? 0} servers` : "Quota / Limit"}
              </span>
            </div>
            {isNeonQuota ? (
              <p className="text-[11px] text-amber-400/90 leading-tight">
                Quota exceeded (HTTP 402). Writes to Neon will be paused until billing cycle resets.
              </p>
            ) : dbStatus?.neon?.error ? (
              <p className="text-[11px] text-rose-400/90 leading-tight truncate">{dbStatus.neon.error}</p>
            ) : (
              <p className="text-[11px] text-emerald-400/80">Online & Healthy</p>
            )}
          </div>

          <div className="p-3 rounded-xl border border-white/8 bg-white/[0.02] space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${!dbStatus?.supabase?.configured ? "bg-zinc-600" : dbStatus?.supabase?.healthy ? "bg-emerald-400" : "bg-rose-500"}`} />
                Supabase Postgres
              </span>
              <span className="font-mono text-[11px] text-zinc-400">
                {!dbStatus?.supabase?.configured ? "Not configured" : dbStatus?.supabase?.healthy ? `${dbStatus.supabase.serverCount ?? 0} servers` : "Offline"}
              </span>
            </div>
            {dbStatus?.supabase?.healthy ? (
              <p className="text-[11px] text-emerald-400/80">Online & Serving traffic</p>
            ) : (
              <p className="text-[11px] text-rose-400/90">{dbStatus?.supabase?.error || "Offline"}</p>
            )}
          </div>
        </div>

        {/* Sync Presets */}
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wider font-mono text-zinc-400">
            Sync Preset
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <button
              type="button"
              onClick={() => handlePresetChange("user-merge-supabase-servers")}
              className={`p-2.5 rounded-xl border text-left transition ${
                preset === "user-merge-supabase-servers"
                  ? "border-violet-500/50 bg-violet-500/10 text-violet-200"
                  : "border-white/8 bg-white/[0.02] text-zinc-400 hover:border-white/15 hover:text-zinc-200"
              }`}
            >
              <div className="font-medium text-zinc-200 flex items-center justify-between">
                <span>Keep Supabase + Merge Users</span>
                <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-violet-500/20 text-violet-300 font-mono">Recommended</span>
              </div>
              <div className="text-[11px] text-zinc-400 mt-1">
                Keep Supabase servers (push to Neon) & two-way merge all active user analytics.
              </div>
            </button>

            <button
              type="button"
              onClick={() => handlePresetChange("two-way-all")}
              className={`p-2.5 rounded-xl border text-left transition ${
                preset === "two-way-all"
                  ? "border-violet-500/50 bg-violet-500/10 text-violet-200"
                  : "border-white/8 bg-white/[0.02] text-zinc-400 hover:border-white/15 hover:text-zinc-200"
              }`}
            >
              <div className="font-medium text-zinc-200">Full Two-Way Merge</div>
              <div className="text-[11px] text-zinc-400 mt-1">
                Bi-directional sync of servers, routing rules, and user telemetry.
              </div>
            </button>

            <button
              type="button"
              onClick={() => handlePresetChange("supabase-to-neon")}
              className={`p-2.5 rounded-xl border text-left transition ${
                preset === "supabase-to-neon"
                  ? "border-violet-500/50 bg-violet-500/10 text-violet-200"
                  : "border-white/8 bg-white/[0.02] text-zinc-400 hover:border-white/15 hover:text-zinc-200"
              }`}
            >
              <div className="font-medium text-zinc-200">Clone Supabase ➔ Neon</div>
              <div className="text-[11px] text-zinc-400 mt-1">
                Directly overwrite Neon with all data from Supabase.
              </div>
            </button>

            <button
              type="button"
              onClick={() => handlePresetChange("custom")}
              className={`p-2.5 rounded-xl border text-left transition ${
                preset === "custom"
                  ? "border-violet-500/50 bg-violet-500/10 text-violet-200"
                  : "border-white/8 bg-white/[0.02] text-zinc-400 hover:border-white/15 hover:text-zinc-200"
              }`}
            >
              <div className="font-medium text-zinc-200">Custom Configuration</div>
              <div className="text-[11px] text-zinc-400 mt-1">
                Customize exact entity toggles, directions, and conflict strategies.
              </div>
            </button>
          </div>
        </div>

        {/* Detailed Entity Selectors */}
        <div className="space-y-3 rounded-xl border border-white/8 bg-white/[0.02] p-4 text-xs">
          <div className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 pb-1 border-b border-white/6">
            Entity Settings
          </div>

          {/* 1. Servers */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1.5 border-b border-white/5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={syncServers}
                onChange={(e) => { setSyncServers(e.target.checked); setPreset("custom"); }}
                className="rounded border-zinc-700 bg-zinc-900 text-violet-500 focus:ring-0"
              />
              <span className="font-medium text-zinc-200">Servers & Configs</span>
            </label>
            {syncServers && (
              <div className="flex items-center gap-2">
                <select
                  value={serversDirection}
                  onChange={(e) => { setServersDirection(e.target.value as any); setPreset("custom"); }}
                  className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-violet-500"
                >
                  <option value="supabase-to-neon">Supabase ➔ Neon</option>
                  <option value="neon-to-supabase">Neon ➔ Supabase</option>
                  <option value="two-way">Two-way Merge</option>
                </select>
                <select
                  value={serversStrategy}
                  onChange={(e) => { setServersStrategy(e.target.value as any); setPreset("custom"); }}
                  className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-violet-500"
                >
                  <option value="overwrite">Overwrite target</option>
                  <option value="keep-target">Keep target on conflict</option>
                </select>
              </div>
            )}
          </div>

          {/* 2. Users */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1.5 border-b border-white/5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={syncUsers}
                onChange={(e) => { setSyncUsers(e.target.checked); setPreset("custom"); }}
                className="rounded border-zinc-700 bg-zinc-900 text-violet-500 focus:ring-0"
              />
              <span className="font-medium text-zinc-200">Active Users & Devices</span>
            </label>
            {syncUsers && (
              <select
                value={usersStrategy}
                onChange={(e) => { setUsersStrategy(e.target.value as any); setPreset("custom"); }}
                className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-violet-500"
              >
                <option value="two-way-merge">Two-way Merge (All devices & timestamps)</option>
                <option value="supabase-to-neon">Supabase ➔ Neon</option>
                <option value="neon-to-supabase">Neon ➔ Supabase</option>
              </select>
            )}
          </div>

          {/* 3. Routing Rules */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1.5 border-b border-white/5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={syncRules}
                onChange={(e) => { setSyncRules(e.target.checked); setPreset("custom"); }}
                className="rounded border-zinc-700 bg-zinc-900 text-violet-500 focus:ring-0"
              />
              <span className="font-medium text-zinc-200">Routing Rules</span>
            </label>
            {syncRules && (
              <select
                value={rulesStrategy}
                onChange={(e) => { setRulesStrategy(e.target.value as any); setPreset("custom"); }}
                className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-violet-500"
              >
                <option value="two-way-merge">Two-way Merge</option>
                <option value="supabase-to-neon">Supabase ➔ Neon</option>
                <option value="neon-to-supabase">Neon ➔ Supabase</option>
              </select>
            )}
          </div>

          {/* 4. Global Settings */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={syncSettings}
                onChange={(e) => { setSyncSettings(e.target.checked); setPreset("custom"); }}
                className="rounded border-zinc-700 bg-zinc-900 text-violet-500 focus:ring-0"
              />
              <span className="font-medium text-zinc-200">Settings & Catalog State</span>
            </label>
            {syncSettings && (
              <select
                value={settingsDirection}
                onChange={(e) => { setSettingsDirection(e.target.value as any); setPreset("custom"); }}
                className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-violet-500"
              >
                <option value="supabase-to-neon">Supabase ➔ Neon</option>
                <option value="neon-to-supabase">Neon ➔ Supabase</option>
              </select>
            )}
          </div>
        </div>

        {/* Sync Output Result */}
        {result && (
          <div className={`p-4 rounded-xl border text-xs space-y-2 ${
            result.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-rose-500/40 bg-rose-500/10 text-rose-200"
          }`}>
            <div className="font-medium flex items-center justify-between">
              <span>{result.ok ? "Synchronization Complete" : "Sync Failed"}</span>
              {result.ok && result.source && result.target && (
                <span className="font-mono text-[11px] opacity-80">
                  {result.source} ➔ {result.target}
                </span>
              )}
            </div>

            {result.ok && result.synced && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                <div className="p-2 rounded bg-black/30 border border-white/5">
                  <span className="text-zinc-400 block text-[9px] uppercase">Servers</span>
                  <span className="text-emerald-300 font-bold">{result.synced.servers}</span>
                </div>
                <div className="p-2 rounded bg-black/30 border border-white/5">
                  <span className="text-zinc-400 block text-[9px] uppercase">Users</span>
                  <span className="text-emerald-300 font-bold">{result.synced.devices}</span>
                </div>
                <div className="p-2 rounded bg-black/30 border border-white/5">
                  <span className="text-zinc-400 block text-[9px] uppercase">Routing Rules</span>
                  <span className="text-emerald-300 font-bold">{result.synced.routingRules}</span>
                </div>
                <div className="p-2 rounded bg-black/30 border border-white/5">
                  <span className="text-zinc-400 block text-[9px] uppercase">Settings</span>
                  <span className="text-emerald-300 font-bold">{result.synced.settings}</span>
                </div>
              </div>
            )}

            {result.error && (
              <p className="text-rose-300 leading-relaxed font-sans">{result.error}</p>
            )}

            {result.synced?.details && result.synced.details.length > 0 && (
              <details className="mt-2 text-[11px] font-mono text-zinc-400 cursor-pointer">
                <summary className="hover:text-zinc-200 transition">View synchronization log</summary>
                <ul className="mt-2 space-y-1 pl-3 border-l border-white/10 max-h-32 overflow-y-auto">
                  {result.synced.details.map((log, i) => (
                    <li key={i}>{log}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void handleExecuteSync()}
            disabled={loading || (!syncServers && !syncUsers && !syncRules && !syncSettings)}
            className="px-5 py-2 rounded-xl text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/30 transition disabled:opacity-40 flex items-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Synchronizing...
              </>
            ) : (
              "Execute Sync"
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
