"use client";

import { useCallback, useEffect, useState } from "react";

type RoutingRuleRecord = {
  id: string;
  type: string;
  value: string;
  created_at: string;
};

export function RoutingRulesPanel({
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
  const [rules, setRules] = useState<RoutingRuleRecord[]>([]);
  const [bulkIp, setBulkIp] = useState("");
  const [bulkDomain, setBulkDomain] = useState("");
  const [bulkProcess, setBulkProcess] = useState("");

  const loadRules = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api<{ rules: RoutingRuleRecord[] }>("/api/admin/routing");
      setRules(res.rules);
    } catch (e) {
      setMsg({ ok: false, text: "Failed to load routing rules" });
    } finally {
      setBusy(false);
    }
  }, [api, setBusy, setMsg]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const addRules = async (type: string, raw: string, setRaw: (s: string) => void) => {
    if (!raw.trim()) return;
    setBusy(true);
    try {
      const lines = raw.split(/[\n,]+/).map(r => r.trim()).filter(Boolean);
      const mapped = lines.map(value => ({ type, value }));
      
      await api("/api/admin/routing", {
        method: "POST",
        body: JSON.stringify({ rules: mapped })
      });
      setMsg({ ok: true, text: `Added ${mapped.length} ${type} rules` });
      setRaw("");
      await loadRules();
    } catch (e) {
      setMsg({ ok: false, text: "Failed to add rules" });
    } finally {
      setBusy(false);
    }
  };

  const removeRule = async (id: string) => {
    setBusy(true);
    try {
      await api(`/api/admin/routing/${id}`, { method: "DELETE" });
      setMsg({ ok: true, text: "Rule deleted" });
      await loadRules();
    } catch (e) {
      setMsg({ ok: false, text: "Failed to delete rule" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="rounded-[28px] border border-zinc-900 bg-zinc-950/70 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">IP Rules</h3>
        <p className="mt-1 text-sm text-zinc-500">Bypass VPN for these IPs (one per line or comma separated).</p>
        <div className="mt-4">
          <textarea
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-cyan-500 font-mono resize-none"
            rows={5}
            value={bulkIp}
            onChange={(e) => setBulkIp(e.target.value)}
            placeholder="94.101.178.69&#10;193.176.243.25"
          />
          <button
            type="button"
            disabled={busy || !bulkIp.trim()}
            onClick={() => void addRules("ip", bulkIp, setBulkIp)}
            className="mt-3 rounded-2xl bg-cyan-400 px-6 py-2.5 text-sm font-semibold text-cyan-950 transition hover:bg-cyan-300 disabled:opacity-50"
          >
            Add IP Rules
          </button>
        </div>
      </div>

      <div className="rounded-[28px] border border-zinc-900 bg-zinc-950/70 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Domain Rules</h3>
        <p className="mt-1 text-sm text-zinc-500">Bypass VPN for these domains. Prefix with `domain:` for Xray syntax.</p>
        <div className="mt-4">
          <textarea
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-cyan-500 font-mono resize-none"
            rows={5}
            value={bulkDomain}
            onChange={(e) => setBulkDomain(e.target.value)}
            placeholder="domain:splus.ir&#10;domain:divar.ir"
          />
          <button
            type="button"
            disabled={busy || !bulkDomain.trim()}
            onClick={() => void addRules("domain", bulkDomain, setBulkDomain)}
            className="mt-3 rounded-2xl bg-cyan-400 px-6 py-2.5 text-sm font-semibold text-cyan-950 transition hover:bg-cyan-300 disabled:opacity-50"
          >
            Add Domain Rules
          </button>
        </div>
      </div>

      <div className="rounded-[28px] border border-zinc-900 bg-zinc-950/70 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Process Rules</h3>
        <p className="mt-1 text-sm text-zinc-500">Bypass VPN for these processes.</p>
        <div className="mt-4">
          <textarea
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-cyan-500 font-mono resize-none"
            rows={5}
            value={bulkProcess}
            onChange={(e) => setBulkProcess(e.target.value)}
            placeholder="MaxGaming.exe&#10;cs2.exe"
          />
          <button
            type="button"
            disabled={busy || !bulkProcess.trim()}
            onClick={() => void addRules("process", bulkProcess, setBulkProcess)}
            className="mt-3 rounded-2xl bg-cyan-400 px-6 py-2.5 text-sm font-semibold text-cyan-950 transition hover:bg-cyan-300 disabled:opacity-50"
          >
            Add Process Rules
          </button>
        </div>
      </div>

      <div className="rounded-[28px] border border-zinc-900 bg-zinc-950/70 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Active Rules</h3>
        <p className="mt-1 text-sm text-zinc-500">List of all applied bypass rules.</p>
        <div className="mt-4 flex flex-col gap-2 max-h-96 overflow-y-auto pr-2">
          {rules.length === 0 && <p className="text-zinc-500 text-sm">No rules active.</p>}
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] font-bold uppercase text-zinc-400">
                  {rule.type}
                </span>
                <span className="font-mono text-sm text-zinc-200">{rule.value}</span>
              </div>
              <button
                type="button"
                onClick={() => void removeRule(rule.id)}
                disabled={busy}
                className="text-xs text-rose-400 hover:text-rose-300 transition px-2 py-1"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
