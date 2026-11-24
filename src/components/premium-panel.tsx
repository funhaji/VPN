"use client";

import { useCallback, useEffect, useState } from "react";

type Subscription = { id: string; reference: string; kind: string; days: number; devices: number; device_limit: number; traffic_limit: string; used_bytes: string; expires_at: string | null; revoked_at: string | null };
type Server = { id: string; name: string; country: string; controller_node: string; enabled: boolean };
type Log = { id: string; device_hash: string | null; subscription_id: string | null; event: string; detail: string; created_at: string };
type BlockedDevice = { device_hash: string; platform: string | null; blocked_at: string };
export function PremiumPanel() {
  const [data, setData] = useState<{ subscriptions: Subscription[]; servers: Server[]; logs: Log[]; devices: BlockedDevice[]; controllerConfigured: boolean }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
  const [node, setNode] = useState("");
  const [config, setConfig] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/premium", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load premium"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function action(payload: object) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/premium", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.key) setIssued(result.key);
      if ("action" in payload && payload.action === "server") { setConfig(""); setName(""); }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Operation failed"); }
    finally { setBusy(false); }
  }
  const input = "w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm";
  return <section className="space-y-5 min-w-0">
    <header className="flex justify-between"><div><h2 className="text-xl font-semibold">Premium control</h2><p className="text-sm text-slate-400">Keys, private servers and security events. Quotas are shared across the key’s devices.</p></div><button onClick={() => void load()}>Refresh</button></header>
    {error && <p role="alert" className="text-rose-300">{error}</p>}
    {data && !data.controllerConfigured && <p className="rounded-xl border border-amber-400/30 p-3 text-amber-200">VPN-node enforcement is not configured. Previews and key activation work, but premium credentials will not be released until a trusted controller is deployed.</p>}
    {issued && <div className="rounded-xl border border-emerald-400/30 p-4"><strong>Save this key now — shown only once</strong><p className="break-all font-mono my-3 select-all">{issued}</p><div className="flex gap-2"><button onClick={() => { void navigator.clipboard.writeText(issued); }}>Copy key</button><button onClick={() => setIssued("")}>Dismiss key</button></div></div>}
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
      </div><p className="text-xs text-slate-400">The clock starts on first redemption. Redeemed device slots cannot be reset by logging out.</p><button disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2">Create key</button>
    </form>
    <form className="rounded-2xl border border-white/10 p-4 space-y-3" onSubmit={e => { e.preventDefault(); void action({ action: "server", name, country, node, rawConfig: config }); }}>
      <h3 className="font-semibold">Add private premium server</h3><div className="grid sm:grid-cols-3 gap-3"><label>Display name<input className={input} required maxLength={70} value={name} onChange={e => setName(e.target.value)} /></label><label>Country<input className={input} required maxLength={80} value={country} onChange={e => setCountry(e.target.value)} /></label><label>Controller node ID<input className={input} required value={node} onChange={e => setNode(e.target.value)} /></label></div>
      <label className="block">Private profile template<textarea className={`${input} min-h-32 font-mono`} required value={config} onChange={e => setConfig(e.target.value)} placeholder="Node controller profile template — encrypted at rest, never published to the free catalog" /></label><button disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2">Add premium server</button>
    </form>
    <div className="rounded-2xl border border-white/10 p-4 space-y-3"><h3 className="font-semibold">Premium servers</h3>{data?.servers.map(server => <div className="flex justify-between gap-3 border-t border-white/10 pt-3" key={server.id}><span>{server.name} · {server.country}<small className="block text-slate-400">{server.controller_node}</small></span><button disabled={busy} onClick={() => void action({ action: "toggle-server", id: server.id, enabled: !server.enabled })}>{server.enabled ? "Disable" : "Enable"}</button></div>)}</div>
    <div className="rounded-2xl border border-white/10 p-4 space-y-3"><h3 className="font-semibold">Subscriptions</h3>{data?.subscriptions.map(sub => <div className="flex justify-between gap-3 border-t border-white/10 pt-3" key={sub.id}><div><strong className="font-mono">{sub.reference}</strong><p className="text-sm text-slate-400">{sub.kind} · {sub.days} days · {sub.devices}/{sub.device_limit} devices · {(Number(sub.used_bytes) / 1073741824).toFixed(2)}/{(Number(sub.traffic_limit) / 1073741824).toFixed(2)} GiB</p><p className="text-xs text-slate-400">{sub.revoked_at ? "Revoked" : sub.expires_at ? `Expires ${new Date(sub.expires_at).toLocaleString()}` : "Awaiting first redemption"}</p></div><button disabled={busy || Boolean(sub.revoked_at)} onClick={() => { if (confirm(`Revoke ${sub.reference}?`)) void action({ action: "revoke", id: sub.id }); }}>Revoke</button></div>)}</div>
    <div className="rounded-2xl border border-white/10 p-4 space-y-3"><h3 className="font-semibold">Blocked devices</h3><p className="text-xs text-slate-400">Devices blocked by the protocol guard. Unblocking clears the block and restores the subscription that was revoked with it.</p>{data?.devices.length ? data.devices.map(device => <div className="flex justify-between gap-3 border-t border-white/10 pt-3 break-all" key={device.device_hash}><span><strong className="font-mono text-xs">{device.device_hash}</strong><small className="block text-slate-400">{device.platform || "unknown platform"} · blocked {new Date(device.blocked_at).toLocaleString()}</small></span><button disabled={busy} onClick={() => { if (confirm(`Unblock device ${device.device_hash.slice(0, 12)}… and restore its subscription?`)) void action({ action: "unblock-device", deviceHash: device.device_hash }); }}>Unblock</button></div>) : <p className="text-sm text-slate-400">No blocked devices.</p>}</div>
    <div className="rounded-2xl border border-white/10 p-4 space-y-3"><h3 className="font-semibold">Security audit · latest 200 events</h3><p className="text-xs text-slate-400">No subscription secrets, server credentials, browsing destinations or request bodies are logged.</p>{data?.logs.map(log => <article key={log.id} className="border-t border-white/10 pt-3 break-all"><strong>{log.event}</strong><time className="block text-xs text-slate-400">{new Date(log.created_at).toLocaleString()}</time><p className="text-sm">{log.detail}</p><p className="text-xs text-slate-400">Device: {log.device_hash || "—"} · Subscription: {log.subscription_id || "—"}</p></article>)}</div>
  </section>;
}
