"use client";

import { useCallback, useEffect, useState } from "react";

type Subscription = { id: string; reference: string; kind: string; days: number; devices: number; device_limit: number; traffic_limit: string; used_bytes: string; activated_at: string | null; expires_at: string | null; revoked_at: string | null };
type Server = { id: string; name: string; country: string; controller_node: string; enabled: boolean };
type Log = { id: string; device_hash: string | null; device_id: string | null; subscription_id: string | null; event: string; detail: string; created_at: string };
type BlockedDevice = { device_hash: string; device_id: string | null; platform: string | null; blocked_at: string };
type EnrolledDevice = { device_hash: string; device_id: string | null; platform: string | null; blocked_at: string | null; trial_claimed_at: string | null; active_reference: string | null; linked_trial: boolean };
type DeviceBinding = { subscription_id: string; device_hash: string; device_id: string | null; platform: string; blocked_at: string | null; redeemed_at: string };
export function PremiumPanel() {
  const [data, setData] = useState<{ subscriptions: Subscription[]; servers: Server[]; logs: Log[]; devices: BlockedDevice[]; enrolledDevices: EnrolledDevice[]; bindings: DeviceBinding[] }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [issued, setIssued] = useState("");
  const [days, setDays] = useState(30);
  const [devices, setDevices] = useState(1);
  const [gb, setGb] = useState(30);
  const [plan, setPlan] = useState("custom");
  type Plan = { label: string; days: number; devices: number; gb: number };
  const plans: Plan[] = [
    { label: "Trial · 3 days · 1 device · 5 GiB", days: 3, devices: 1, gb: 5 },
    { label: "Monthly · 30 days · 2 devices · 50 GiB", days: 30, devices: 2, gb: 50 },
    { label: "Quarterly · 90 days · 3 devices · 150 GiB", days: 90, devices: 3, gb: 150 },
  ];
  const applyPlan = (p: Plan) => { setPlan(p.label); setDays(p.days); setDevices(p.devices); setGb(p.gb); };
  const [name, setName] = useState("");
  const [country, setCountry] = useState("DE");
  const [config, setConfig] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editDays, setEditDays] = useState(30);
  const [editDevices, setEditDevices] = useState(1);
  const [editTrafficGiB, setEditTrafficGiB] = useState(30);
  const [editUsedGiB, setEditUsedGiB] = useState(0);
  const [editExpiry, setEditExpiry] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/premium", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load premium"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function action(payload: object) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/premium", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.key) setIssued(result.key);
      if ("action" in payload && payload.action === "server") { setConfig(""); setName(""); }
      setNotice("Changes saved successfully.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Operation failed"); }
    finally { setBusy(false); }
  }
  const input = "mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20";
  const button = "inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-40";
  const secondary = `${button} border-white/15 bg-white/5 text-slate-200 hover:bg-white/10`;
  const primary = `${button} border-cyan-400/30 bg-cyan-400/15 text-cyan-200 hover:bg-cyan-400/25`;
  const danger = `${button} border-rose-400/30 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20`;
  const card = "rounded-2xl border border-white/10 bg-zinc-950/40 p-4 sm:p-5 space-y-4";
  const startEditing = (sub: Subscription) => {
    setEditingId(sub.id); setEditDays(sub.days); setEditDevices(sub.device_limit);
    setEditTrafficGiB(Number(sub.traffic_limit) / 1073741824); setEditUsedGiB(Number(sub.used_bytes) / 1073741824);
    const expiry = sub.expires_at ? new Date(sub.expires_at) : null;
    setEditExpiry(expiry ? new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");
  };
  const visibleSubscriptions = data?.subscriptions.filter(sub => `${sub.reference} ${sub.kind}`.toLowerCase().includes(search.toLowerCase().trim()));
  return <section className="space-y-5 min-w-0">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">Premium control</h2><p className="text-sm text-slate-400">Keys, private servers and security events. Quotas are shared across the key’s devices.</p></div><button className={secondary} disabled={loading || busy} onClick={() => void load()}>{loading ? "Refreshing…" : "Refresh"}</button></header>
    {notice && <p role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{notice}</p>}
    {data && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Subscriptions", data.subscriptions.length], ["Revoked", data.subscriptions.filter(sub => sub.revoked_at).length], ["Enabled servers", data.servers.filter(server => server.enabled).length], ["Blocked devices", data.devices.length]].map(([label, count]) => <div key={label} className={card}><p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p><p className="text-2xl font-semibold text-slate-100">{count}</p></div>)}</div>}
    {error && <p role="alert" className="text-rose-300">{error}</p>}
    <p className="rounded-xl border border-amber-400/30 p-3 text-amber-200">Imported provider configs are delivered only to active subscribers. No node controller is required. Updated Android apps deduct app-reported traffic; authoritative billing requires provider integration. Revoking an app subscription cannot disable copied provider credentials.</p>
    {issued && <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-4"><strong>Save this key now — shown only once</strong><p className="break-all font-mono my-3 select-all">{issued}</p><div className="flex flex-wrap gap-2"><button className={primary} onClick={() => { void navigator.clipboard.writeText(issued).then(() => setNotice("Key copied."), () => setError("Clipboard unavailable. Select and copy the key manually.")); }}>Copy key</button><button className={secondary} onClick={() => setIssued("")}>Dismiss key</button></div></div>}
    <form className="rounded-2xl border border-white/10 p-4 space-y-3" onSubmit={e => { e.preventDefault(); void action({ action: "issue", days, devices, bytes: Math.round(gb * 1073741824) }); }}>
      <h3 className="font-semibold">Create subscription key</h3>
      <div className="flex flex-wrap gap-2">
        {plans.map(p => (
          <button type="button" key={p.label} onClick={() => applyPlan(p)} aria-pressed={plan === p.label}
            className={`rounded-full border px-3 py-1.5 text-xs transition ${plan === p.label ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-200" : "border-white/15 text-slate-300 hover:border-white/30"}`}>
            {p.label}
          </button>
        ))}
        <button type="button" onClick={() => setPlan("custom")} aria-pressed={plan === "custom"}
          className={`rounded-full border px-3 py-1.5 text-xs transition ${plan === "custom" ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-200" : "border-white/15 text-slate-300 hover:border-white/30"}`}>
          Custom
        </button>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label>Days<input className={input} type="number" min="1" max="3650" required value={days} onChange={e => setDays(Number(e.target.value))} /></label>
        <label>Device slots<input className={input} type="number" min="1" max="100" required value={devices} onChange={e => setDevices(Number(e.target.value))} /></label>
        <label>Total traffic (GiB)<input className={input} type="number" min="0.01" step="0.01" required value={gb} onChange={e => setGb(Number(e.target.value))} /></label>
      </div><p className="text-xs text-slate-400">The clock starts on first redemption. Redeemed device slots cannot be reset by logging out.</p><button disabled={busy} className={primary}>{busy ? "Saving…" : "Create key"}</button>
    </form>
    <form className="rounded-2xl border border-white/10 p-4 space-y-3" onSubmit={e => { e.preventDefault(); void action({ action: "server", name, country, rawConfig: config }); }}>
      <h3 className="font-semibold">Add private premium server</h3><div className="grid sm:grid-cols-2 gap-3"><label>Display name<input className={input} required maxLength={70} value={name} onChange={e => setName(e.target.value)} /></label><label>Country<input className={input} required maxLength={80} value={country} onChange={e => setCountry(e.target.value)} /></label></div>
      <label className="block">Private provider config<textarea className={`${input} min-h-32 font-mono`} required value={config} onChange={e => setConfig(e.target.value)} placeholder="Imported share link or JSON profile — encrypted at rest, never published to the free catalog" /></label><button disabled={busy} className={primary}>Add premium server</button>
    </form>
    <div className={card}><h3 className="font-semibold">Premium servers</h3>{data?.servers.map(server => <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3" key={server.id}><span className="min-w-0 break-words">{server.name} · {server.country}<small className="block text-slate-400">{server.controller_node} · {server.enabled ? "Enabled" : "Disabled"}</small></span><button className={server.enabled ? secondary : primary} disabled={busy} onClick={() => void action({ action: "toggle-server", id: server.id, enabled: !server.enabled })}>{server.enabled ? "Disable" : "Enable"}</button></div>)}{data && !data.servers.length && <p className="text-sm text-slate-400">No premium servers yet. Add one above or use Premium only in the server editor.</p>}</div>
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Subscriptions</h3><input aria-label="Search subscriptions" placeholder="Search reference or plan…" className={`${input} sm:max-w-xs`} value={search} onChange={e => setSearch(e.target.value)} /></div>
      <p className="text-xs text-slate-400">Unrevoking removes revocation only. It does not extend expiry, reset traffic, or unblock devices.</p>
      {visibleSubscriptions?.map(sub => {
        const expired = Boolean(sub.expires_at && new Date(sub.expires_at).getTime() <= Date.now());
        const exhausted = Number(sub.used_bytes) >= Number(sub.traffic_limit);
        const status = sub.revoked_at ? "Revoked" : expired ? "Expired" : exhausted ? "Traffic exhausted" : sub.expires_at ? "Active" : "Awaiting redemption";
        const assigned = data?.bindings.filter(binding => binding.subscription_id === sub.id) ?? [];
        return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4" key={sub.id}>
          <div className="min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-2"><strong className="break-all font-mono">{sub.reference}</strong><span className={`rounded-full border px-2.5 py-1 text-xs ${status === "Active" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-white/15 bg-white/5 text-slate-300"}`}>{status}</span></div><p className="text-sm text-slate-400">{sub.kind} · {sub.days} days · {sub.devices}/{sub.device_limit} devices · {(Number(sub.used_bytes) / 1073741824).toFixed(2)}/{(Number(sub.traffic_limit) / 1073741824).toFixed(2)} GiB</p><p className="text-xs text-slate-400">{sub.expires_at ? `Expires ${new Date(sub.expires_at).toLocaleString()}` : "Clock starts on first redemption"}</p></div>
          <button className={secondary} disabled={busy} onClick={() => startEditing(sub)}>Edit</button>
          <button className={secondary} disabled={busy} onClick={() => { if (confirm(`Rotate ${sub.reference}? The old key stops working; the replacement is shown once.`)) void action({ action: "rotate-key", id: sub.id }); }}>Rotate key</button>
          <button className={sub.revoked_at ? primary : danger} disabled={busy} onClick={() => {
            const operation = sub.revoked_at ? "unrevoke" : "revoke";
            if (confirm(sub.revoked_at ? `Unrevoke ${sub.reference}? Expiry, traffic usage and device blocks will not change.` : `Revoke ${sub.reference}?`)) void action({ action: operation, id: sub.id });
          }}>{sub.revoked_at ? "Unrevoke" : "Revoke"}</button>
          {editingId === sub.id && <form className="w-full basis-full rounded-xl border border-white/10 bg-black/20 p-3 space-y-3" onSubmit={e => {
            e.preventDefault();
            const trafficLimit = Math.round(editTrafficGiB * 1073741824);
            const usedBytes = Math.round(editUsedGiB * 1073741824);
            if (usedBytes > trafficLimit) { setError("Used traffic cannot exceed the traffic limit."); return; }
            void action({ action: "edit-key", id: sub.id, days: editDays, devices: editDevices, trafficLimit, usedBytes,
              expiresAt: editExpiry ? new Date(editExpiry).toISOString() : null });
            setEditingId("");
          }}>
            <h4 className="font-medium">Edit {sub.reference}</h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label>Plan days<input className={input} type="number" min="1" max="3650" required value={editDays} onChange={e => setEditDays(Number(e.target.value))} /></label>
              <label>Device limit<input className={input} type="number" min="1" max="100" required value={editDevices} onChange={e => setEditDevices(Number(e.target.value))} /></label>
              <label>Traffic limit (GiB)<input className={input} type="number" min="0.01" step="any" required value={editTrafficGiB} onChange={e => setEditTrafficGiB(Number(e.target.value))} /></label>
              <label>Traffic used (GiB)<input className={input} type="number" min="0" step="any" required value={editUsedGiB} onChange={e => setEditUsedGiB(Number(e.target.value))} /></label>
              <label>Expires at<input className={input} type="datetime-local" value={editExpiry} onChange={e => setEditExpiry(e.target.value)} /></label>
            </div>
            <div className="flex flex-wrap gap-2"><button disabled={busy} className={primary}>Save changes</button><button type="button" disabled={busy} className={secondary} onClick={() => setEditUsedGiB(0)}>Set used traffic to 0</button><button type="button" className={secondary} onClick={() => setEditingId("")}>Cancel</button></div>
          </form>}
          {assigned.map(device => <div key={device.device_hash} className="w-full basis-full flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2 text-sm"><span className="break-all">{device.device_id || `Legacy hash: ${device.device_hash}`} Â· {device.platform}{device.blocked_at ? " Â· blocked" : ""}</span><button className={danger} disabled={busy} onClick={() => { if (confirm(`Remove ${device.device_id || "this device"} from ${sub.reference}?`)) void action({ action: "remove-device", id: sub.id, deviceHash: device.device_hash }); }}>Remove device</button></div>)}
        </div>;
      })}
      {data && !visibleSubscriptions?.length && <p className="text-sm text-slate-400">{search ? "No subscriptions match your search." : "No subscriptions yet. Create a key above."}</p>}
    </div>
    <div className={card}><h3 className="font-semibold">Blocked devices</h3><p className="text-xs text-slate-400">Devices blocked by the protocol guard. Unblocking clears the block and restores the subscription that was revoked with it.</p>{data?.devices.length ? data.devices.map(device => <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3" key={device.device_hash}><span className="min-w-0 break-all"><strong className="font-mono text-xs">{device.device_id || `Legacy hash: ${device.device_hash}`}</strong><small className="block text-slate-400">{device.platform || "unknown platform"} · blocked {new Date(device.blocked_at).toLocaleString()}</small></span><button className={primary} disabled={busy} onClick={() => { if (confirm(`Unblock device ${device.device_id || device.device_hash.slice(0, 12)} and restore its subscription?`)) void action({ action: "unblock-device", deviceHash: device.device_hash }); }}>Unblock</button></div>) : <p className="text-sm text-slate-400">{loading ? "Loading devices…" : "No blocked devices."}</p>}</div>
    <div className="rounded-2xl border border-white/10 p-4 space-y-3"><h3 className="font-semibold">Security audit · latest 200 events</h3><p className="text-xs text-slate-400">No subscription secrets, server credentials, browsing destinations or request bodies are logged.</p>{data?.logs.map(log => <article key={log.id} className="border-t border-white/10 pt-3 break-all"><strong>{log.event}</strong><time className="block text-xs text-slate-400">{new Date(log.created_at).toLocaleString()}</time><p className="text-sm">{log.detail}</p><p className="text-xs text-slate-400">Device: {log.device_id || (log.device_hash ? `Legacy hash: ${log.device_hash}` : "—")} · Subscription: {log.subscription_id || "—"}</p></article>)}</div>
    <div className={card}><h3 className="font-semibold">Enrolled devices and trials</h3><p className="text-xs text-slate-400">Only Remove device on every linked trial above restores trial eligibility. Expiry, logout and recovery do not remove trial links. Blocked devices and active premium plans remain ineligible.</p>{data?.enrolledDevices.map(device => <div key={device.device_hash} className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3"><span className="min-w-0 break-all"><strong className="font-mono text-xs">{device.device_id || `Legacy hash: ${device.device_hash}`}</strong><small className="block text-slate-400">{device.platform || "unknown platform"} · {device.active_reference ? `Key ${device.active_reference}` : "No active key"} · {device.linked_trial ? "Linked to a trial" : "No trial link"}{device.blocked_at ? " · blocked" : ""}</small></span></div>)}{data && !data.enrolledDevices.length && <p className="text-sm text-slate-400">No enrolled devices yet.</p>}</div>
  </section>;
}
