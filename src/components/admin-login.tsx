"use client";

import { FormEvent, useState } from "react";

export function AdminLogin() {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showPass, setShowPass] = useState(false);

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
        setMessage("Wrong password. Try again.");
        return;
      }
      window.location.reload();
    } catch {
      setMessage("Connection failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4"
      style={{
        background: "radial-gradient(ellipse at 20% 0%, rgba(6,182,212,0.12) 0%, transparent 50%), radial-gradient(ellipse at 80% 100%, rgba(139,92,246,0.10) 0%, transparent 50%), #09090b"
      }}>

      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-4xl">
        <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">

          {/* Left panel */}
          <div className="hidden flex-col justify-between rounded-3xl border border-white/8 bg-white/4 p-8 shadow-2xl backdrop-blur-xl md:flex">
            <div>
              {/* Logo mark */}
              <div className="inline-flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 shadow-lg shadow-cyan-500/25">
                  <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                </div>
                <span className="text-sm font-semibold tracking-tight text-zinc-200">Astro VPN</span>
              </div>

              <h1 className="mt-6 text-3xl font-semibold leading-snug text-zinc-50">
                Admin Control<br />
                <span className="text-cyan-400">Panel</span>
              </h1>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                Manage your VPN server inventory with encrypted storage, protocol-specific builders, and bulk operations.
              </p>
            </div>

            {/* Feature list */}
            <div className="mt-8 space-y-2.5">
              {[
                { icon: "🔐", label: "Encrypted server storage (Neon DB)" },
                { icon: "⚡", label: "V2Ray, SSH, L2TP, OpenVPN, WireGuard" },
                { icon: "📦", label: "Bulk import & credential management" },
                { icon: "🌐", label: "Geo routing rules & flag auto-detection" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-3 rounded-2xl border border-white/6 bg-white/3 px-4 py-3 text-sm text-zinc-300"
                >
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                </div>
              ))}
            </div>
          </div>

          {/* Right panel - Login form */}
          <form
            onSubmit={submit}
            className="flex flex-col justify-center rounded-3xl border border-white/8 bg-white/4 p-8 shadow-2xl backdrop-blur-xl"
          >
            {/* Mobile logo */}
            <div className="mb-6 flex items-center gap-2 md:hidden">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500">
                <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-zinc-200">Astro VPN</span>
            </div>

            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400/80">Secure Access</p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-50">Unlock Control Panel</h2>
            <p className="mt-1.5 text-sm text-zinc-400">Enter your admin password to continue.</p>

            <div className="mt-7 space-y-4">
              {/* Password field */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">Password</label>
                <div className="relative">
                  <input
                    value={pass}
                    onChange={(event) => setPass(event.target.value)}
                    type={showPass ? "text" : "password"}
                    autoFocus
                    placeholder="Enter admin password"
                    className="w-full rounded-2xl border border-zinc-700/60 bg-zinc-900/80 px-4 py-3 pr-12 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-zinc-500 transition hover:text-zinc-300"
                    tabIndex={-1}
                  >
                    {showPass ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Error banner */}
              {message && (
                <div className="flex items-center gap-2.5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                  <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  {message}
                </div>
              )}

              <button
                disabled={busy || pass.trim().length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-cyan-400 px-4 py-3 text-sm font-semibold text-cyan-950 shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Unlocking...
                  </>
                ) : (
                  <>
                    Unlock Panel
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
