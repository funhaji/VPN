"use client";

import { useState, useMemo, useId } from "react";
import type { AdminServerRecord as ServerRecord, ProtocolOptions } from "@/types/server";
import { detectProfileMetadata, splitImportedProfiles } from "@/lib/profile-import";
import { normalizeLocationCode, flagFromCountryCode } from "@/lib/countries";

const stripLeadingCountryFlag = (value: string): string =>
  value
    .replace(/^(?:[\u{1F1E6}-\u{1F1FF}]{2}|[\p{Emoji_Presentation}\p{Extended_Pictographic}])\s*/u, "")
    .replace(/^[-—:\s]+/, "")
    .trim();

interface BulkReplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedServers: ServerRecord[];
  allServers: ServerRecord[];
  onSuccess: () => Promise<void>;
  api: <T>(url: string, init?: RequestInit) => Promise<T>;
}

export function BulkReplaceModal({
  isOpen,
  onClose,
  selectedServers,
  allServers,
  onSuccess,
  api,
}: BulkReplaceModalProps) {
  const [rawInput, setRawInput] = useState("");
  const [nameMode, setNameMode] = useState<"replacing" | "keep_replaced">("replacing");
  const [applyToAllSlots, setApplyToAllSlots] = useState(true);
  const [inheritOptions, setInheritOptions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rawInputId = useId();

  const firstSelectedPosition = useMemo(() => {
    if (selectedServers.length === 0) return 1;
    const idx = allServers.findIndex((s) => s.id === selectedServers[0].id);
    return idx !== -1 ? idx + 1 : 1;
  }, [allServers, selectedServers]);

  const rawProfiles = useMemo(() => {
    const trimmed = rawInput.trim();
    if (!trimmed) return [];
    return splitImportedProfiles(trimmed);
  }, [rawInput]);

  const shouldExpandSingle = rawProfiles.length === 1 && selectedServers.length > 1 && applyToAllSlots;

  const parsedIncomingProfiles = useMemo(() => {
    if (rawProfiles.length === 0) return [];

    const profiles = shouldExpandSingle
      ? Array.from({ length: selectedServers.length }, () => rawProfiles[0])
      : rawProfiles;

    return profiles.map((p, idx) => {
      const meta = detectProfileMetadata(p, "custom:tcp");
      const targetServer = selectedServers[idx] || selectedServers[0];

      let resolvedName = meta.name;
      let countryCode = "GLOBAL";

      if (nameMode === "keep_replaced" && targetServer) {
        resolvedName = targetServer.name;
        countryCode = targetServer.country || "GLOBAL";
      } else {
        // Use replacing config's name
        if (shouldExpandSingle) {
          resolvedName = `${meta.name} #${idx + 1}`;
        } else {
          resolvedName = meta.name;
        }

        const detectedNameCountry = normalizeLocationCode(meta.name);
        countryCode = normalizeLocationCode(
          meta.country && meta.country !== "XX" && meta.country !== "GLOBAL"
            ? meta.country
            : detectedNameCountry && detectedNameCountry !== "GLOBAL" && detectedNameCountry !== "XX"
              ? detectedNameCountry
              : targetServer?.country || resolvedName,
        );

        const flag = countryCode !== "GLOBAL" && countryCode !== "XX" ? flagFromCountryCode(countryCode) : "";
        if (flag && !resolvedName.startsWith(flag)) {
          resolvedName = `${flag} ${stripLeadingCountryFlag(resolvedName).trim()}`;
        }
      }

      const options: ProtocolOptions = inheritOptions && targetServer?.options
        ? { ...targetServer.options }
        : { mux: false, fragment: false, sniffing: true, allowInsecure: false, extra: {} };

      return {
        name: resolvedName,
        protocol: meta.protocol,
        country: countryCode,
        rawConfig: meta.rawConfig,
        host: meta.host,
        port: meta.port,
        isEnabled: true,
        options,
      };
    });
  }, [rawProfiles, shouldExpandSingle, selectedServers, nameMode, inheritOptions]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (loading) return;
    setError(null);
    setRawInput("");
    onClose();
  };

  const handleSubmit = async () => {
    if (parsedIncomingProfiles.length === 0 || selectedServers.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      const oldIds = selectedServers.map((s) => s.id);
      await api<{ ok: boolean; inserted: number; deleted: number }>("/api/admin/servers/bulk-replace", {
        method: "POST",
        body: JSON.stringify({
          oldIds,
          servers: parsedIncomingProfiles,
        }),
      });

      await onSuccess();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to replace servers");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 p-4 shadow-2xl text-zinc-100 space-y-3.5">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-4">
          <div>
            <h2 className="text-lg font-semibold tracking-wide text-zinc-100 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
              Bulk Replace V2Ray Servers
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              Replace {selectedServers.length} selected server{selectedServers.length === 1 ? "" : "s"} with new configuration in the exact catalog position.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-200 transition disabled:opacity-40"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Selected Servers Being Replaced */}
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-indigo-300">
              Target Selection ({selectedServers.length} to be deleted):
            </span>
            <span className="text-zinc-400">
              Slot position #{firstSelectedPosition}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto py-1 pr-1">
            {selectedServers.map((s, idx) => {
              const fullIndex = allServers.findIndex((srv) => srv.id === s.id);
              const posLabel = fullIndex !== -1 ? `#${fullIndex + 1}` : `#${idx + 1}`;
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-1.5 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-zinc-300"
                >
                  <span className="text-zinc-500 font-mono text-[10px]">{posLabel}</span>
                  <span className="font-medium truncate max-w-[140px]">{s.name}</span>
                  <span className="text-[10px] uppercase text-zinc-400 font-mono">
                    {s.protocol.split(":")[1] || s.protocol}
                  </span>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-zinc-400">
            The selected servers will be permanently removed and replaced by your new configuration starting at position #{firstSelectedPosition}.
          </p>
        </div>

        {/* New Config Input */}
        <div className="space-y-2">
          <label htmlFor={rawInputId} className="block text-xs font-medium text-zinc-300">
            New V2Ray Server Configuration / Share Link
          </label>
          <textarea
            id={rawInputId}
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            disabled={loading}
            rows={5}
            placeholder={"Paste a new V2Ray share link (vless://, vmess://, trojan://, shadowsocks://, or JSON)...\nPaste multiple links to replace one-by-one."}
            className="w-full rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-xs text-zinc-200 placeholder-zinc-500 focus:border-indigo-400 focus:outline-none transition"
          />
        </div>

        {/* Live Preview of Parsed Input */}
        {rawInput.trim().length > 0 && (
          <div className="space-y-2">
            {parsedIncomingProfiles.length === 0 ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300">
                No valid V2Ray profile recognized. Please paste a standard share link (vless://, vmess://, trojan://) or JSON outbound configuration.
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-emerald-300 font-medium">
                  <span>
                    ✓ {parsedIncomingProfiles.length} new server{parsedIncomingProfiles.length === 1 ? "" : "s"} detected
                    {shouldExpandSingle ? ` (1 config applied to ${selectedServers.length} slots)` : ""}
                  </span>
                  <span className="text-zinc-400 font-normal">
                    Will insert at position #{firstSelectedPosition}
                  </span>
                </div>

                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {parsedIncomingProfiles.map((p, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-lg border border-white/5 bg-black/40 px-2.5 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-emerald-400 font-mono text-[11px]">#{firstSelectedPosition + idx}</span>
                        <span className="font-medium truncate text-zinc-200">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 text-[11px] text-zinc-400 font-mono">
                        <span className="uppercase text-indigo-300">{p.protocol.split(":")[1] || p.protocol}</span>
                        {p.host ? <span>{p.host}:{p.port}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Options */}
        <div className="space-y-3 rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Naming Mode */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-300">
                Server Names
              </label>
              <div className="flex rounded-lg border border-white/10 bg-black/40 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setNameMode("replacing")}
                  disabled={loading}
                  className={`flex-1 rounded-md px-2.5 py-1.5 font-medium transition ${
                    nameMode === "replacing"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Use replacing config name
                </button>
                <button
                  type="button"
                  onClick={() => setNameMode("keep_replaced")}
                  disabled={loading}
                  className={`flex-1 rounded-md px-2.5 py-1.5 font-medium transition ${
                    nameMode === "keep_replaced"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Keep replaced name
                </button>
              </div>
              <p className="text-[11px] text-zinc-400">
                {nameMode === "replacing"
                  ? "Uses remarks / hash title from the new config."
                  : "Preserves the original names of the servers being replaced."}
              </p>
            </div>

            {/* Checkbox Options */}
            <div className="space-y-2 pt-1">
              {rawProfiles.length === 1 && selectedServers.length > 1 && (
                <label className="flex items-center gap-2.5 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyToAllSlots}
                    onChange={(e) => setApplyToAllSlots(e.target.checked)}
                    disabled={loading}
                    className="rounded border-zinc-700 bg-zinc-900 accent-indigo-400"
                  />
                  <span>Apply config to all {selectedServers.length} selected slots</span>
                </label>
              )}

              <label className="flex items-center gap-2.5 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inheritOptions}
                  onChange={(e) => setInheritOptions(e.target.checked)}
                  disabled={loading}
                  className="rounded border-zinc-700 bg-zinc-900 accent-indigo-400"
                />
                <span>Inherit options (mux, fragment, sniffing)</span>
              </label>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-700 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={loading || parsedIncomingProfiles.length === 0}
            className="rounded-xl border border-indigo-500/40 bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "Replacing Servers..." : `Replace ${selectedServers.length} Server${selectedServers.length === 1 ? "" : "s"}`}
          </button>
        </div>

      </div>
    </div>
  );
}
