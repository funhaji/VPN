/**
 * Astro VPN download worker (Cloudflare Workers).
 *
 * Serves app binaries from a hidden origin (GitHub — public or private — or an
 * R2 bucket) behind short-lived signed links issued by the Vercel site.
 *
 *   GET /<id>.<exp>.<sig>/<filename>
 *
 * - The origin is never revealed: no redirects, origin headers are stripped.
 * - Bandwidth is served by Cloudflare (Workers have no egress fees), not Vercel.
 * - Files are cached at the Cloudflare edge (custom domain required for cache).
 *
 * Secrets / vars (see README.md):
 *   SIGNING_SECRET   must equal DOWNLOAD_SIGNING_SECRET on Vercel
 *   FILES            JSON map of id -> source (kept as a secret, not in git)
 *   GITHUB_TOKEN     optional; required if the app repo is private
 *   CACHE_SECONDS    optional edge-cache TTL (default 3600)
 *   SITE_URL         optional; where "/" and expired links send people
 *   BUCKET           optional R2 binding for { "type": "r2" } sources
 */

const CONTENT_TYPES = {
  apk: "application/vnd.android.package-archive",
  exe: "application/vnd.microsoft.portable-executable",
  deb: "application/vnd.debian.binary-package",
  rpm: "application/x-rpm",
  appimage: "application/octet-stream",
};

const enc = new TextEncoder();
const keyCache = new Map();

async function hmac(secret, data) {
  let key = keyCache.get(secret);
  if (!key) {
    key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keyCache.set(secret, key);
  }
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const text = (status, body, extra = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra },
  });

function goHome(env, status = 302) {
  return env.SITE_URL ? Response.redirect(env.SITE_URL, status) : text(404, "Not found");
}

let filesCache;
function getFiles(env) {
  if (!filesCache) filesCache = JSON.parse(env.FILES || "{}");
  return filesCache;
}

/** Fetch the bytes from the hidden origin. Returns a Response (or null). */
async function fetchOrigin(file, env, range) {
  const src = file.source;
  const token = env.GITHUB_TOKEN;
  const gh = { "User-Agent": "AstroVPN-Download/1.0", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const rangeHdr = range ? { Range: range } : {};

  if (src.type === "r2") {
    if (!env.BUCKET) throw new Error("R2 binding BUCKET missing");
    const obj = await env.BUCKET.get(src.key, range ? { range: new Headers({ Range: range }) } : undefined);
    if (!obj) return null;
    const h = new Headers();
    h.set("content-length", String(obj.range ? obj.range.length ?? obj.size : obj.size));
    h.set("accept-ranges", "bytes");
    if (obj.range && range) {
      const off = obj.range.offset ?? 0;
      const len = obj.range.length ?? obj.size - off;
      h.set("content-range", `bytes ${off}-${off + len - 1}/${obj.size}`);
      return new Response(obj.body, { status: 206, headers: h });
    }
    return new Response(obj.body, { status: 200, headers: h });
  }

  if (src.type === "url") {
    return fetch(src.url, { headers: { "User-Agent": gh["User-Agent"], ...rangeHdr } });
  }

  if (src.type === "github-release") {
    if (!token) {
      // Public repo: follow GitHub's redirect server-side (client never sees it).
      return fetch(`https://github.com/${src.repo}/releases/download/${encodeURIComponent(src.tag)}/${encodeURIComponent(src.asset)}`, {
        headers: { ...gh, ...rangeHdr },
      });
    }
    // Private repo: look up the asset, then download via the API.
    const rel = await fetch(`https://api.github.com/repos/${src.repo}/releases/tags/${encodeURIComponent(src.tag)}`, {
      headers: { ...gh, Accept: "application/vnd.github+json" },
    });
    if (!rel.ok) return null;
    const asset = (await rel.json()).assets?.find((a) => a.name === src.asset);
    if (!asset) return null;
    const step = await fetch(asset.url, { headers: { ...gh, Accept: "application/octet-stream" }, redirect: "manual" });
    const loc = step.headers.get("location");
    if (!loc) return step.ok ? step : null;
    // Signed storage URL — must NOT receive the Authorization header.
    return fetch(loc, { headers: { "User-Agent": gh["User-Agent"], ...rangeHdr } });
  }

  if (src.type === "github-file") {
    const ref = encodeURIComponent(src.ref || "main");
    const path = src.path.split("/").map(encodeURIComponent).join("/");
    if (!token) {
      return fetch(`https://raw.githubusercontent.com/${src.repo}/${ref}/${path}`, { headers: { ...gh, ...rangeHdr } });
    }
    return fetch(`https://api.github.com/repos/${src.repo}/contents/${path}?ref=${ref}`, {
      headers: { ...gh, ...rangeHdr, Accept: "application/vnd.github.raw" },
    });
  }

  throw new Error(`Unknown source type: ${src.type}`);
}

function clientHeaders(originRes, file) {
  // Build fresh headers so nothing from GitHub (x-github-*, etag, server…) leaks.
  const h = new Headers();
  const ext = file.filename.split(".").pop().toLowerCase();
  h.set("content-type", CONTENT_TYPES[ext] || "application/octet-stream");
  h.set("content-disposition", `attachment; filename="${file.filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
  for (const k of ["content-length", "content-range", "last-modified"]) {
    const v = originRes.headers.get(k);
    if (v) h.set(k, v);
  }
  h.set("accept-ranges", "bytes");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "no-referrer");
  h.set("x-robots-tag", "noindex, nofollow");
  h.set("access-control-allow-origin", "*");
  return h;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // IP echo for the app (/api/client/ip on the site is proxied here so it
    // costs no Vercel CPU). Vercel's proxy sends the visitor IP as x-real-ip.
    if (url.pathname === "/ip") {
      const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "Content-Type",
      };
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      const ip = request.headers.get("x-real-ip") || xff || request.headers.get("cf-connecting-ip") || "unknown";
      return new Response(JSON.stringify({ ip }), {
        headers: { ...cors, "content-type": "application/json", "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate" },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return text(405, "Method not allowed", { allow: "GET, HEAD" });
    }

    const [token] = url.pathname.split("/").filter(Boolean);
    if (!token || url.pathname === "/robots.txt") {
      return url.pathname === "/robots.txt" ? text(200, "User-agent: *\nDisallow: /\n") : goHome(env);
    }

    const m = /^([a-z0-9-]{1,32})\.(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!m || !env.SIGNING_SECRET) return text(404, "Not found");
    const [, id, expStr, sig] = m;

    if (!safeEqual(await hmac(env.SIGNING_SECRET, `${id}.${expStr}`), sig)) return text(404, "Not found");
    if (Number(expStr) * 1000 < Date.now()) {
      // Expired: send the user back to the site to get a fresh link.
      return goHome(env);
    }

    const file = getFiles(env)[id];
    if (!file) return text(404, "Not found");

    const range = request.headers.get("range");
    const cache = caches.default;
    // Cache key is per-file (not per-token) so every user shares one cached copy.
    const cacheKey = new Request(`https://download-cache.internal/${id}/${encodeURIComponent(file.filename)}`, {
      headers: range ? { Range: range } : {},
    });

    let res = await cache.match(cacheKey);
    if (res) {
      const h = clientHeaders(res, file);
      h.set("x-cache", "HIT");
      return new Response(request.method === "HEAD" ? null : res.body, { status: res.status, headers: h });
    }

    let origin;
    try {
      origin = await fetchOrigin(file, env, range);
    } catch (err) {
      console.error(err);
      return text(502, "Download temporarily unavailable, please try again.");
    }
    if (!origin || !(origin.ok || origin.status === 206)) {
      console.error(`Origin error for ${id}: ${origin && origin.status}`);
      return text(502, "Download temporarily unavailable, please try again.");
    }

    const headers = clientHeaders(origin, file);
    headers.set("x-cache", "MISS");

    // Store full (non-range) responses at the edge. Ranges are then served from cache.
    if (!range && origin.status === 200 && request.method === "GET") {
      const [a, b] = origin.body.tee();
      const toCache = new Response(b, { status: 200, headers: new Headers(headers) });
      toCache.headers.set("cache-control", `public, max-age=${Number(env.CACHE_SECONDS) || 3600}`);
      toCache.headers.delete("x-cache");
      ctx.waitUntil(cache.put(new Request(cacheKey.url), toCache).catch((e) => console.error("cache put", e)));
      return new Response(a, { status: 200, headers });
    }

    if (request.method === "HEAD") {
      origin.body?.cancel();
      return new Response(null, { status: origin.status, headers });
    }
    return new Response(origin.body, { status: origin.status, headers });
  },
};
