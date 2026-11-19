"use client";

import { useState } from "react";
import type { DuplicateMatch } from "@/lib/server-duplicates";

export function DuplicateReport() {
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return <details className="my-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
    <summary className="cursor-pointer font-semibold">Duplicate & shared endpoint review</summary>
    <p className="my-3 text-xs text-slate-400">Imports and edits check for exact configuration duplicates. Shared hosts, IPs, ports, or credentials are listed for review because some protocols legitimately share them.</p>
    <button type="button" disabled={busy} className="rounded-lg bg-zinc-800 px-3 py-2 disabled:opacity-50" onClick={async () => {
      setBusy(true);
      try {
        const response = await fetch("/api/admin/servers/duplicates");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Review failed");
        setMatches(data.matches);
        setMessage(data.total ? `${data.total} matches${data.total > 500 ? " (showing first 500)" : ""}.` : "No duplicate configurations or shared endpoints found.");
      } catch (error) { setMessage(error instanceof Error ? error.message : "Review failed"); }
      finally { setBusy(false); }
    }}>{busy ? "Checking…" : "Check stored servers"}</button>
    <p role="status" className="my-2 text-sm">{message}</p>
    <ul className="max-h-72 space-y-2 overflow-auto text-sm">{matches.map((match, index) => <li key={index} className="rounded-lg bg-white/5 p-2">
      <span className={match.kind === "duplicate" ? "text-amber-300" : "text-cyan-300"}>{match.kind.replaceAll("-", " ")}</span>: {match.incoming} ↔ {match.existing}
    </li>)}</ul>
  </details>;
}
