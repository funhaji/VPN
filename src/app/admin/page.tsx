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
      {/* Slim top nav */}
      <header className="sticky top-0 z-50 border-b border-white/6 bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500 shadow shadow-cyan-500/30">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-zinc-100">Astro VPN</span>
            <span className="hidden text-zinc-700 sm:block">·</span>
            <span className="hidden text-xs font-medium text-zinc-500 sm:block">Admin Panel</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-2 w-2 rounded-full bg-emerald-400 shadow shadow-emerald-400/50" />
            <span className="text-xs text-zinc-500">Connected</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-6 md:px-6">
        <AdminDashboard />
      </div>
    </main>
  );
}
