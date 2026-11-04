import type { NextConfig } from "next";

const downloadBase = process.env.DOWNLOAD_BASE_URL?.trim().replace(/\/+$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    if (!downloadBase) return [];
    return {
      // /api/client/ip is the most-called endpoint. Proxy it to the Cloudflare
      // worker at Vercel's CDN layer so it never runs a Vercel function.
      // (Vercel forwards the visitor IP to the worker as x-real-ip.)
      // If DOWNLOAD_BASE_URL is unset, the local route handler is used instead.
      beforeFiles: [{ source: "/api/client/ip", destination: `${downloadBase}/ip` }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
