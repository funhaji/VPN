import { cookies } from "next/headers";
import { AdminDashboard } from "@/components/admin-dashboard";
import { AdminLogin } from "@/components/admin-login";
import { hasValidSessionToken, SESSION_COOKIE } from "@/lib/session";

export default async function Home() {
  const cookieStore = await cookies();
  const hasSession = hasValidSessionToken(cookieStore.get(SESSION_COOKIE)?.value);

  if (!hasSession) {
    return <AdminLogin />;
  }

  return (
    <main className="space-bg min-h-screen">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8 md:px-8">
        <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-white/6 px-6 py-5 shadow-[0_20px_80px_rgba(2,6,23,0.45)] backdrop-blur-xl">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent" />
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-2">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/90">
                Astro Theme
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 md:text-4xl">Astro VPN</h1>
              <p className="max-w-2xl text-sm leading-6 text-zinc-300">
                Mission control for protocol routing, runtime readiness, encrypted inventory, and cleaner multi-profile imports.
              </p>
            </div>
            <div className="grid gap-3 text-sm text-zinc-300 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-zinc-950/35 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Stack</div>
                <div className="mt-1 font-medium text-zinc-100">Next.js + Neon</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-zinc-950/35 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Focus</div>
                <div className="mt-1 font-medium text-zinc-100">Bulk import + runtime-ready profiles</div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <AdminDashboard />
    </main>
  );
}
