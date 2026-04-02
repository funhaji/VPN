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
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 pt-8 md:px-8">
        <section className="flex items-center justify-between rounded-2xl border border-zinc-800/80 bg-zinc-900/60 px-5 py-4 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 md:text-3xl">Astro VPN</h1>
            <p className="text-sm text-zinc-400">Mission control for protocol routing, runtime readiness, and encrypted server inventory.</p>
          </div>
          <div className="hidden rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs font-medium text-cyan-300 md:block">
            Vercel + Neon
          </div>
        </section>
      </div>
      <AdminDashboard />
    </main>
  );
}
