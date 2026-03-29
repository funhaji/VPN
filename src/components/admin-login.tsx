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
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900 px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-xl shadow-black/35"
      >
        <h1 className="text-2xl font-semibold text-zinc-50">Astro VPN Admin</h1>
        <p className="mt-1 text-sm text-zinc-400">Enter PASS to unlock server manager</p>
        <input
          value={pass}
          onChange={(event) => setPass(event.target.value)}
          type="password"
          autoFocus
          placeholder="PASS"
          className="mt-5 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
        />
        <button
          disabled={busy || pass.trim().length === 0}
          className="mt-4 w-full rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-cyan-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Unlocking..." : "Unlock"}
        </button>
        {message ? <p className="mt-3 text-sm text-rose-300">{message}</p> : null}
      </form>
    </main>
  );
}
