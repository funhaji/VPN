"use client";

import { useEffect, useState } from "react";

type Status = { enabled: boolean; count: number; fetchedAt: string | null };
export function JumpJumpPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function api(init?: RequestInit) {
    const response = await fetch("/api/admin/jumpjump", { ...init, cache: "no-store", headers: { "Content-Type": "application/json" } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "JumpJump request failed");
    return result;
  }
  useEffect(() => {
    let active = true;
    api().then(result => { if (active) setStatus(result); }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, []);
  async function update(refresh: boolean) {
    if (!status || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await api({ method: refresh ? "POST" : "PATCH", body: JSON.stringify(refresh ? { action: "refresh" } : { enabled: !status.enabled }) });
      setStatus(await api());
      setMessage("Saved and published. Clients receive this change on their next server refresh.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "JumpJump request failed"); setStatus(await api().catch(() => null)); }
    finally { setBusy(false); }
  }
  return <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
    <h2 className="font-semibold text-white">JumpJump free servers</h2>
    <p className="text-sm text-zinc-400">Guest-accessible servers use their isolated compatible core alongside your normal free servers. Refresh preserves the last complete snapshot if the provider fails. Premium servers are unaffected.</p>
    {status && <p className="text-sm text-zinc-300">{status.enabled ? "Enabled" : "Disabled"} · {status.count} fetched servers · Last refresh: {status.fetchedAt ? new Date(status.fetchedAt).toLocaleString() : "Never"}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={!status || busy} onClick={() => void update(false)} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm disabled:opacity-40">{status?.enabled ? "Disable JumpJump" : "Enable JumpJump"}</button>
      <button type="button" disabled={!status || busy} onClick={() => void update(true)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-40">{busy ? "Working…" : "Fetch fresh free servers"}</button>
    </div>
    <p className="text-xs text-amber-300">Changes are published automatically, preserving other currently published servers. Disabled JumpJump servers disappear on the next successful client refresh. Offline devices cannot receive changes until they reconnect.</p>
    {message && <p role="status" className="text-sm text-zinc-300">{message}</p>}
  </div>;
}
