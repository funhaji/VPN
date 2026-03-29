import { AdminDashboard } from "@/components/admin-dashboard";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 pt-10 md:px-8">
        <h1 className="text-3xl font-semibold text-zinc-50">Astro VPN</h1>
        <p className="text-sm text-zinc-400">Vercel + Neon secure server manager</p>
      </div>
      <AdminDashboard />
    </main>
  );
}
