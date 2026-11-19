"use client";

import { useCallback, useEffect, useState } from "react";
import type { DuplicateMatch } from "@/lib/server-duplicates";

type PlatformRule = {
  minimumBuild: number;
  blockedBuilds: number[];
  disabled: boolean;
};

type Policy = {
  legacyEnabled: boolean;
  allServersRemoved: boolean;
  android: PlatformRule;
  windows: PlatformRule;
  messageEn: string;
  messageFa: string;
};

type PublicationInfo = {
  generation: number;
  count: number;
  revision?: string | null;
};

export function AccessPolicyPanel({
  api,
  busy,
  setBusy,
  setMsg,
}: {
  api?: <T>(path: string, init?: RequestInit) => Promise<T>;
  busy?: boolean;
  setBusy?: (b: boolean) => void;
  setMsg?: (msg: { ok: boolean; text: string } | null) => void;
}) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [publication, setPublication] = useState<PublicationInfo | null>(null);
  const [authorizeEmptyPublication, setAuthorizeEmptyPublication] = useState(false);
  const [blockedInput, setBlockedInput] = useState<{ android: string; windows: string }>({
    android: "",
    windows: "",
  });

  // Duplication & shared endpoints state
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [scanMessage, setScanMessage] = useState("");
  const [scanning, setScanning] = useState(false);
  const [duplicateFilter, setDuplicateFilter] = useState<string>("all");

  const isBusy = busy ?? localBusy;
  const updateBusy = (val: boolean) => {
    if (setBusy) setBusy(val);
    setLocalBusy(val);
  };
  const notify = (ok: boolean, text: string) => {
    if (setMsg) setMsg({ ok, text });
  };

  const fetchJson = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      if (api) return api<T>(url, init);
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json", ...init?.headers },
        ...init,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      return data;
    },
    [api],
  );

  const loadPolicy = useCallback(async () => {
    try {
      const data = await fetchJson<Policy>("/api/admin/access-policy");
      setPolicy(data);
      setBlockedInput({
        android: data.android.blockedBuilds.join(", "),
        windows: data.windows.blockedBuilds.join(", "),
      });
    } catch (error) {
      notify(false, error instanceof Error ? error.message : "Failed to load access policy");
    }
  }, [fetchJson]);

  const loadPublication = useCallback(async () => {
    try {
      const data = await fetchJson<PublicationInfo>("/api/admin/publication");
      setPublication(data);
    } catch {
      // V2 publication may be unconfigured or pending initial publish
      setPublication(null);
    }
  }, [fetchJson]);

  useEffect(() => {
    void loadPolicy();
    void loadPublication();
  }, [loadPolicy, loadPublication]);

  const savePolicy = async () => {
    if (!policy) return;
    updateBusy(true);
    try {
      await fetchJson("/api/admin/access-policy", {
        method: "PUT",
        body: JSON.stringify(policy),
      });
      notify(true, "Access policy saved. Publish a new V2 generation to apply changes to V2 clients.");
    } catch (error) {
      notify(false, error instanceof Error ? error.message : "Failed to save access policy");
    } finally {
      updateBusy(false);
    }
  };

  const publishCatalog = async () => {
    if (!publication) {
      // Try to load generation first
      await loadPublication();
    }
    const currentGen = publication?.generation ?? 0;
    updateBusy(true);
    try {
      const res = await fetchJson<{ ok: boolean; generation: number; revision: string }>("/api/admin/publication", {
        method: "POST",
        body: JSON.stringify({
          expectedGeneration: currentGen,
          allServersRemoved: authorizeEmptyPublication,
        }),
      });
      setPublication((prev) => ({
        generation: res.generation,
        count: prev?.count ?? 0,
        revision: res.revision,
      }));
      setAuthorizeEmptyPublication(false);
      notify(true, `V2 Catalog Generation ${res.generation} successfully published!`);
      await loadPublication();
    } catch (error) {
      notify(false, error instanceof Error ? error.message : "Publication failed");
    } finally {
      updateBusy(false);
    }
  };

  const scanDuplicates = async () => {
    setScanning(true);
    try {
      const res = await fetchJson<{ matches: DuplicateMatch[]; total: number }>("/api/admin/servers/duplicates");
      setMatches(res.matches || []);
      setScanMessage(
        res.total > 0
          ? `Found ${res.total} match${res.total === 1 ? "" : "es"}${res.total > 500 ? " (showing first 500)" : ""}.`
          : "Clean! No duplicate configurations or shared endpoints detected across stored servers.",
      );
    } catch (error) {
      setScanMessage(error instanceof Error ? error.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const filteredMatches = matches.filter((m) => {
    if (duplicateFilter === "all") return true;
    return m.kind === duplicateFilter;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-emerald-950/30 via-zinc-950/60 to-cyan-950/30 p-5 shadow-xl backdrop-blur-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30 text-base">
                🛡️
              </span>
              <h2 className="text-xl font-bold tracking-tight text-zinc-50">Catalog & Safety Center</h2>
            </div>
            <p className="text-xs text-zinc-400">
              Manage cryptographic V2 edge delivery, enforce minimum app versions, customize update alerts, and audit server endpoint uniqueness.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-xs ring-1 ${
                publication && publication.generation > 0
                  ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                  : "bg-amber-500/10 text-amber-300 ring-amber-500/30"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${publication && publication.generation > 0 ? "bg-emerald-400" : "bg-amber-400"}`} />
              {publication && publication.generation > 0 ? `V2 Gen ${publication.generation} (${publication.count} srv)` : "V2 Unpublished"}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-xs ring-1 ${
                policy?.legacyEnabled ? "bg-cyan-500/10 text-cyan-300 ring-cyan-500/30" : "bg-rose-500/10 text-rose-300 ring-rose-500/30"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${policy?.legacyEnabled ? "bg-cyan-400" : "bg-rose-400"}`} />
              {policy?.legacyEnabled ? "Legacy API: On" : "Legacy API: Blocked"}
            </span>
          </div>
        </div>
      </div>

      {/* Grid: Publication & Version Policy */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 1. V2 Catalog Publication Card */}
        <div className="flex flex-col justify-between rounded-2xl border border-white/6 bg-zinc-950/70 p-5 shadow-lg backdrop-blur-sm">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/30 text-xs">
                  📦
                </span>
                <h3 className="text-base font-semibold text-zinc-100">V2 Catalog Edge Delivery</h3>
              </div>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void loadPublication()}
                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-300 transition hover:bg-white/10 disabled:opacity-40"
              >
                Refresh
              </button>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              Synchronizes the active server list and access rules to Cloudflare Worker edge nodes with ECDSA signature verification. Clients fetch and decrypt this sealed catalog using ephemeral session nonces.
            </p>

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-white/5 bg-black/30 p-3.5">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Published Generation</p>
                <p className="mt-1 font-mono text-lg font-bold text-cyan-300">
                  {publication ? `#${publication.generation}` : "None"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Active Server Count</p>
                <p className="mt-1 font-mono text-lg font-bold text-emerald-300">
                  {publication ? `${publication.count} servers` : "0"}
                </p>
              </div>
            </div>

            {/* Authorize empty catalog guard */}
            <label className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs cursor-pointer hover:bg-amber-500/10 transition">
              <input
                type="checkbox"
                checked={authorizeEmptyPublication}
                onChange={(e) => setAuthorizeEmptyPublication(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-amber-500 focus:ring-amber-500"
              />
              <span className="text-amber-200/90 leading-relaxed">
                <strong className="text-amber-200 block font-medium">Authorize empty catalog for this publication</strong>
                Required ONLY if you are intentionally publishing 0 servers. Protects against accidental wiped catalogs.
              </span>
            </label>
          </div>

          <div className="mt-5 pt-3 border-t border-white/5">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void publishCatalog()}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 hover:from-cyan-400 hover:to-blue-500 transition disabled:opacity-40"
            >
              <span>🚀</span>
              <span>
                {isBusy
                  ? "Publishing…"
                  : publication
                  ? `Publish Generation ${publication.generation + 1}`
                  : "Publish Initial V2 Catalog"}
              </span>
            </button>
          </div>
        </div>

        {/* 2. Legacy API & Safety Toggles */}
        <div className="flex flex-col justify-between rounded-2xl border border-white/6 bg-zinc-950/70 p-5 shadow-lg backdrop-blur-sm">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/30 text-xs">
                  ⚡
                </span>
                <h3 className="text-base font-semibold text-zinc-100">Global API Gates</h3>
              </div>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              Emergency switches governing legacy V1 API endpoints and fleet-wide client authorization rules.
            </p>

            <div className="space-y-3">
              {/* Legacy V1 Switch */}
              <div className="flex items-start justify-between gap-4 rounded-xl border border-white/5 bg-black/30 p-3.5">
                <div className="space-y-1">
                  <span className="text-sm font-medium text-zinc-200">Old API Endpoint (V1)</span>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    When disabled, older unencrypted clients receive 20 mandatory update notices instead of valid server configs.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                  <input
                    type="checkbox"
                    checked={policy?.legacyEnabled ?? false}
                    onChange={(e) => policy && setPolicy({ ...policy, legacyEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                </label>
              </div>

              {/* Total Removal Authorization Switch */}
              <div className="flex items-start justify-between gap-4 rounded-xl border border-white/5 bg-black/30 p-3.5">
                <div className="space-y-1">
                  <span className="text-sm font-medium text-zinc-200">Allow Global Client Wipe</span>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Deliberately authorizes clients to clear their cached servers when 0 servers exist. Normal empty responses are treated as network glitches.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                  <input
                    type="checkbox"
                    checked={policy?.allServersRemoved ?? false}
                    onChange={(e) => policy && setPolicy({ ...policy, allServersRemoved: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-3 border-t border-white/5">
            <button
              type="button"
              disabled={isBusy || !policy}
              onClick={() => void savePolicy()}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-100 border border-white/10 hover:bg-white/15 transition disabled:opacity-40"
            >
              <span>💾</span>
              <span>{isBusy ? "Saving…" : "Save Policy Settings"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Section 2: Platform Version Gates */}
      <div className="rounded-2xl border border-white/6 bg-zinc-950/70 p-5 shadow-lg backdrop-blur-sm space-y-4">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30 text-xs">
              📱
            </span>
            <h3 className="text-base font-semibold text-zinc-100">Platform Version Gates & Build Constraints</h3>
          </div>
          <span className="text-xs text-zinc-400">Controls which app build numbers are allowed to connect</span>
        </div>

        {policy && (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {(["android", "windows"] as const).map((platform) => {
              const rule = policy[platform];
              const isAndroid = platform === "android";
              return (
                <div
                  key={platform}
                  className="rounded-xl border border-white/5 bg-black/25 p-4 space-y-4 relative overflow-hidden"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-semibold capitalize text-zinc-200">
                      <span className={`inline-block w-2 h-2 rounded-full ${isAndroid ? "bg-emerald-400" : "bg-cyan-400"}`} />
                      {platform} App Gate
                    </span>
                    <span className="font-mono text-xs text-zinc-400">
                      Min: {rule.minimumBuild}
                    </span>
                  </div>

                  {/* Force Update Kill Switch */}
                  <label className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-zinc-900/50 border border-white/5 text-xs cursor-pointer hover:bg-zinc-900 transition">
                    <span className="text-zinc-300 font-medium">Force ALL {platform} versions to update</span>
                    <input
                      type="checkbox"
                      checked={rule.disabled}
                      onChange={(e) =>
                        setPolicy({
                          ...policy,
                          [platform]: { ...rule, disabled: e.target.checked },
                        })
                      }
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-rose-500 focus:ring-rose-500"
                    />
                  </label>

                  {/* Minimum Build */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-400">
                      Minimum required build number
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={rule.minimumBuild}
                      onChange={(e) =>
                        setPolicy({
                          ...policy,
                          [platform]: {
                            ...rule,
                            minimumBuild: Math.max(0, Math.floor(Number(e.target.value))),
                          },
                        })
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 font-mono focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                      placeholder={isAndroid ? "1003000" : "1002019"}
                    />
                    <p className="text-[11px] text-zinc-500">
                      Clients with build number &lt; {rule.minimumBuild} will be prompted to update.
                    </p>
                  </div>

                  {/* Blocked Builds */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-400">
                      Blocked build numbers (comma separated)
                    </label>
                    <input
                      type="text"
                      value={blockedInput[platform]}
                      onChange={(e) =>
                        setBlockedInput({
                          ...blockedInput,
                          [platform]: e.target.value,
                        })
                      }
                      onBlur={(e) => {
                        const vals = e.target.value
                          .split(",")
                          .map((v) => Number(v.trim()))
                          .filter((v) => !isNaN(v) && Number.isSafeInteger(v) && v >= 0);
                        setPolicy({
                          ...policy,
                          [platform]: {
                            ...rule,
                            blockedBuilds: [...new Set(vals)],
                          },
                        });
                        setBlockedInput({
                          ...blockedInput,
                          [platform]: [...new Set(vals)].join(", "),
                        });
                      }}
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 font-mono focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                      placeholder="e.g. 1002015, 1002018"
                    />
                    <p className="text-[11px] text-zinc-500">
                      Specifically blacklisted buggy builds blocked from establishing tunnels.
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 3: Localized Update Messages */}
      {policy && (
        <div className="rounded-2xl border border-white/6 bg-zinc-950/70 p-5 shadow-lg backdrop-blur-sm space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30 text-xs">
                💬
              </span>
              <h3 className="text-base font-semibold text-zinc-100">Client Update & Announcement Messages</h3>
            </div>
            <span className="text-xs text-zinc-400">Displayed in-app when clients are required to update</span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400 flex items-center justify-between">
                <span>English Message</span>
                <span className="font-mono text-[10px] text-zinc-500">{policy.messageEn.length}/500</span>
              </label>
              <textarea
                rows={3}
                maxLength={500}
                value={policy.messageEn}
                onChange={(e) => setPolicy({ ...policy, messageEn: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 resize-none"
                placeholder="A newer version of Astro VPN is available. Please update to continue connecting."
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400 flex items-center justify-between">
                <span>Persian Message (پیام فارسی)</span>
                <span className="font-mono text-[10px] text-zinc-500">{policy.messageFa.length}/500</span>
              </label>
              <textarea
                dir="rtl"
                rows={3}
                maxLength={500}
                value={policy.messageFa}
                onChange={(e) => setPolicy({ ...policy, messageFa: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 resize-none font-sans"
                placeholder="نسخه جدیدی از استرو وی‌پی‌ان در دسترس است. لطفاً برای اتصال برنامه را به‌روزرسانی کنید."
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void savePolicy()}
              className="rounded-xl bg-cyan-400 px-5 py-2 text-xs sm:text-sm font-semibold text-cyan-950 transition hover:bg-cyan-300 disabled:opacity-50"
            >
              {isBusy ? "Saving…" : "Save Policy & Messages"}
            </button>
          </div>
        </div>
      )}

      {/* Section 4: Duplicate & Shared Endpoint Review */}
      <div className="rounded-2xl border border-white/6 bg-zinc-950/70 p-5 shadow-lg backdrop-blur-sm space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30 text-xs">
              🔍
            </span>
            <div>
              <h3 className="text-base font-semibold text-zinc-100">Duplicate & Shared Endpoint Review</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Audits all stored server configurations for exact duplicates, shared hostnames/IPs, and matching credentials on identical servers.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={scanning}
            onClick={() => void scanDuplicates()}
            className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-50 shrink-0"
          >
            {scanning ? "Auditing Servers…" : "Scan Stored Servers"}
          </button>
        </div>

        {scanMessage && (
          <div
            className={`p-3 rounded-xl border text-xs font-medium ${
              matches.length > 0
                ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            {scanMessage}
          </div>
        )}

        {matches.length > 0 && (
          <div className="space-y-3">
            {/* Filter pills */}
            <div className="flex flex-wrap gap-2 text-xs">
              {[
                { id: "all", label: `All (${matches.length})` },
                { id: "duplicate", label: `Exact Duplicates (${matches.filter((m) => m.kind === "duplicate").length})` },
                { id: "shared-endpoint", label: `Shared Endpoints (${matches.filter((m) => m.kind === "shared-endpoint").length})` },
                { id: "shared-host", label: `Shared Host/IP (${matches.filter((m) => m.kind === "shared-host").length})` },
                { id: "shared-credential", label: `Shared Credentials on Same Server (${matches.filter((m) => m.kind === "shared-credential").length})` },
              ].map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setDuplicateFilter(pill.id)}
                  className={`rounded-lg px-2.5 py-1 text-xs transition font-medium ${
                    duplicateFilter === pill.id
                      ? "bg-white/15 text-white border border-white/20"
                      : "bg-black/30 text-zinc-400 border border-white/5 hover:text-zinc-200"
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Results list */}
            <div className="max-h-80 overflow-y-auto space-y-2 rounded-xl border border-white/5 bg-black/30 p-2 scrollbar-thin">
              {filteredMatches.map((match, idx) => {
                const kindBadge =
                  match.kind === "duplicate"
                    ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
                    : match.kind === "shared-endpoint"
                    ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
                    : match.kind === "shared-host"
                    ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
                    : "bg-violet-500/20 text-violet-300 border-violet-500/30";

                return (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-2.5 text-xs hover:bg-white/[0.04] transition"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${kindBadge}`}>
                        {match.kind.replaceAll("-", " ")}
                      </span>
                      <span className="font-medium text-zinc-200">{match.incoming}</span>
                      <span className="text-zinc-500">↔</span>
                      <span className="font-medium text-zinc-300">{match.existing}</span>
                    </div>
                  </div>
                );
              })}
              {filteredMatches.length === 0 && (
                <p className="text-center py-4 text-xs text-zinc-500">No items match the selected filter.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
