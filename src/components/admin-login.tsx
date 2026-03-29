"use client";

import { FormEvent, useState } from "react";

export function AdminLogin() {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pass }),
      });
      if (!response.ok) {
        setMessage("Wrong PASS");
        return;
      }
      window.location.reload();
    } catch {
      setMessage("Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#1b2a4a_0%,#09090b_30%,#09090b_100%)] px-6">
      <div className="grid w-full max-w-4xl gap-5 md:grid-cols-[1.1fr_0.9fr]">
        <section className="hidden rounded-3xl border border-zinc-800/80 bg-zinc-900/60 p-7 shadow-2xl shadow-black/20 backdrop-blur md:flex md:flex-col md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Astro VPN</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight text-zinc-50">Admin access for your encrypted VPN inventory</h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-zinc-400">
              Manage V2Ray, SSH, OpenVPN, WireGuard, and bulk imports from one place with secure session-based access.
            </p>
          </div>
          <div className="grid gap-3">
            {["Encrypted server storage", "Protocol-specific forms", "Bulk import pipeline"].map((item) => (
              <div key={item} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-300">
                {item}
              </div>
            ))}
          </div>
        </section>

        <form
          onSubmit={submit}
          className="w-full rounded-3xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-xl shadow-black/35 backdrop-blur"
        >
          <h1 className="text-2xl font-semibold text-zinc-50">Unlock Control Panel</h1>
          <p className="mt-1 text-sm text-zinc-400">Enter PASS to access the Astro VPN dashboard</p>
          <input
            value={pass}
            onChange={(event) => setPass(event.target.value)}
            type="password"
            autoFocus
            placeholder="PASS"
            className="mt-5 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-cyan-500"
          />
          <button
            disabled={busy || pass.trim().length === 0}
            className="mt-4 w-full rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-cyan-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Unlocking..." : "Unlock"}
          </button>
          {message ? <p className="mt-3 text-sm text-rose-300">{message}</p> : null}
        </form>
      </div>
    </main>
  );
}
