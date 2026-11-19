"use client";

import { useEffect, useState } from "react";

type PlatformRule = { minimumBuild: number; blockedBuilds: number[]; disabled: boolean };
type Policy = { legacyEnabled: boolean; allServersRemoved: boolean; android: PlatformRule; windows: PlatformRule; messageEn: string; messageFa: string };

export function AccessPolicyPanel() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState<number | null>(null);
  const [authorizeEmptyPublication, setAuthorizeEmptyPublication] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/access-policy", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Could not load access policy");
      setPolicy(await response.json());
    }).catch(error => { if (!controller.signal.aborted) setMessage(String(error)); });
    return () => controller.abort();
  }, []);
  async function save() {
    if (!policy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/access-policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save policy");
      setMessage("Access settings saved. Publish a V2 generation to apply them to V2 clients.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); }
    finally { setBusy(false); }
  }
  async function loadPublication() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/publication");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load publication");
      setGeneration(data.generation);
      setMessage(`V2 generation ${data.generation}: ${data.count} published servers.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Publication unavailable"); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (generation === null) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/publication", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedGeneration: generation, allServersRemoved: authorizeEmptyPublication }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Publication failed");
      setGeneration(data.generation);
      setAuthorizeEmptyPublication(false);
      setMessage(`V2 generation ${data.generation} published.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Publication failed"); }
    finally { setBusy(false); }
  }
  return <details className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 my-4">
    <summary className="cursor-pointer font-semibold">API access & catalog safety</summary>
    {policy && <div className="mt-4 grid gap-4">
      <label className="flex gap-3 items-center"><input type="checkbox" checked={policy.legacyEnabled} onChange={event => setPolicy({ ...policy, legacyEnabled: event.target.checked })} />Old API enabled</label>
      <p className="text-xs text-slate-400">When disabled, old clients receive 20 English/Persian update notices. Existing offline caches cannot be remotely erased.</p>
      <label className="flex gap-3 items-center"><input type="checkbox" checked={policy.allServersRemoved} onChange={event => setPolicy({ ...policy, allServersRemoved: event.target.checked })} />Deliberately authorize removal of every client server</label>
      <p className="text-xs text-slate-400">Only enable after all servers have been disabled or deleted. Ordinary empty responses are errors, not removal instructions.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["android", "windows"] as const).map(platform => <fieldset key={platform} className="grid gap-3 rounded-xl border border-white/10 p-3">
          <legend className="px-2 capitalize">{platform} version access</legend>
          <label className="flex items-center gap-2"><input type="checkbox" checked={policy[platform].disabled} onChange={event => setPolicy({ ...policy, [platform]: { ...policy[platform], disabled: event.target.checked } })} />Require all versions to update</label>
          <label className="grid gap-1 text-sm">Minimum build number<input type="number" min="0" step="1" value={policy[platform].minimumBuild} onChange={event => setPolicy({ ...policy, [platform]: { ...policy[platform], minimumBuild: Math.max(0, Math.floor(Number(event.target.value))) } })} className="rounded-lg bg-zinc-900 p-2" /></label>
          <label className="grid gap-1 text-sm">Blocked build numbers (comma-separated)<input defaultValue={policy[platform].blockedBuilds.join(", ")} onBlur={event => {
            const values = event.target.value.trim() ? event.target.value.split(",").map(value => Number(value.trim())) : [];
            if (values.some(value => !Number.isSafeInteger(value) || value < 0)) { setMessage("Blocked builds must be nonnegative integers."); event.target.value = policy[platform].blockedBuilds.join(", "); return; }
            setPolicy({ ...policy, [platform]: { ...policy[platform], blockedBuilds: [...new Set(values)] } });
          }} className="rounded-lg bg-zinc-900 p-2" /></label>
        </fieldset>)}
      </div>
      <label className="grid gap-1 text-sm">English update message<input value={policy.messageEn} maxLength={500} onChange={event => setPolicy({ ...policy, messageEn: event.target.value })} className="rounded-lg bg-zinc-900 p-2" /></label>
      <label className="grid gap-1 text-sm">Persian update message<input dir="rtl" value={policy.messageFa} maxLength={500} onChange={event => setPolicy({ ...policy, messageFa: event.target.value })} className="rounded-lg bg-zinc-900 p-2" /></label>
      <button type="button" disabled={busy} onClick={() => void save()} className="justify-self-start rounded-lg bg-cyan-600 px-4 py-2 disabled:opacity-50">{busy ? "Saving…" : "Save access settings"}</button>
      <div className="grid gap-3 rounded-xl border border-white/10 p-3">
        <h3 className="font-medium">V2 catalog publication</h3>
        <p className="text-xs text-slate-400">Publish the enabled server list and saved version policy together to both API hosts. V2 delivery requires server-side storage and signing configuration.</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={authorizeEmptyPublication} onChange={event => setAuthorizeEmptyPublication(event.target.checked)} />Authorize an empty catalog for this publication only</label>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={() => void loadPublication()} className="rounded-lg bg-zinc-800 px-3 py-2 disabled:opacity-50">Load publication status</button>
          <button type="button" disabled={busy || generation === null} onClick={() => void publish()} className="rounded-lg bg-cyan-600 px-3 py-2 disabled:opacity-50">Publish{generation !== null ? ` generation ${generation + 1}` : " V2 catalog"}</button>
        </div>
      </div>
    </div>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </details>;
}
