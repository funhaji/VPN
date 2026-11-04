# Astro VPN download worker

Serves the app binaries **without exposing GitHub** and **without using Vercel bandwidth**.

```
user ──► vercel: /api/download/arm64  (tiny 302, CDN-cached 5 min)
     ──► dl.yourdomain.com/arm64.<exp>.<sig>/AstroVPN-arm64-v8a.apk   (Cloudflare Worker)
              └─ verifies signature + expiry, streams the file from the hidden origin
                 (GitHub release / raw file / R2), cached at Cloudflare's edge
```

- The browser, the page source, `/api/client/version` and the redirects never contain a GitHub URL.
- Links expire (default 6 h, `DOWNLOAD_LINK_TTL_SECONDS` on Vercel). Expired or forged links get a 404 / redirect to the site, so people can't hotlink them.
- Cloudflare Workers have no egress/bandwidth fees. Free plan: 100,000 requests/day.

## 1. Deploy the worker

```bash
cd download-worker
npx wrangler login
cp files.example.json files.json          # edit OWNER/REPO etc. (files.json is git-ignored)
openssl rand -base64 48                   # -> your signing secret
npx wrangler secret put SIGNING_SECRET    # paste it
npx wrangler secret put FILES < files.json
npx wrangler secret put GITHUB_TOKEN      # only if the app repo is private (fine-grained, read-only "Contents")
npx wrangler deploy
```

**Use a custom domain** (uncomment `routes` in `wrangler.toml`). Edge caching only works on a custom domain, and `*.workers.dev` is frequently filtered in Iran.

Set `SITE_URL` in `wrangler.toml` so expired links send people back to the download page.

## 2. Configure Vercel (Project → Settings → Environment Variables)

| Variable | Value |
| --- | --- |
| `DOWNLOAD_BASE_URL` | `https://dl.yourdomain.com` |
| `DOWNLOAD_SIGNING_SECRET` | same value as the worker's `SIGNING_SECRET` |
| `DOWNLOAD_LINK_TTL_SECONDS` | optional, default `21600` (6 h) |
| `ANDROID_VERSION_URL` | optional, e.g. `https://api.github.com/repos/OWNER/REPO/contents/android/version.txt` |
| `WINDOWS_VERSION_URL` | optional, e.g. `https://api.github.com/repos/OWNER/REPO/contents/version.txt` |
| `VERSION_SOURCE_TOKEN` | optional, read-only GitHub token if the repo is private |

Redeploy. If `DOWNLOAD_BASE_URL`/`DOWNLOAD_SIGNING_SECRET` are missing, downloads return 503 (they never fall back to GitHub).

## Source types (`files.json`)

| type | fields | notes |
| --- | --- | --- |
| `github-release` | `repo`, `tag`, `asset` | public or private (with `GITHUB_TOKEN`) |
| `github-file` | `repo`, `ref`, `path` | private files via the API are limited to 100 MB |
| `r2` | `key` | needs the `BUCKET` binding; zero-egress, best for very large files |
| `url` | `url` | any other origin |

After publishing a new build with the same file name, the edge cache refreshes within `CACHE_SECONDS` (default 1 h).
