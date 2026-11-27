# Workload routing and verification

## Database ownership

- **Supabase:** public/catalog reads (existing preference), Active Users
  heartbeats, analytics and registration checks. Heartbeats no longer mirror to
  Neon. Registration reads never fail over to a stale device replica: a database
  outage must not be mistaken for an unknown device and produce a permanent ban.
- **Neon:** premium account/security state by default, unless
  `PREMIUM_DATABASE_URL` explicitly pins another database. This authority is
  unchanged. Do not round-robin trials, nonces, rate limits, subscriptions or
  usage across independent databases.
- **Both:** infrequent shared catalog/settings edits remain mirrored for the
  existing catalog-read fallback. Partial write failures are logged; they no
  longer trigger a destructive full-catalog background repair.
- With only one configured provider, device traffic uses that provider. Adding
  Supabase later requires an explicit device-data migration first. Existing
  two-provider installations already mirrored those registrations.
- Database status GETs now read only. Use the authenticated admin sync action
  deliberately to repair drift; do not use status probes as repair triggers.

This split reduces duplicated writes, not necessarily Neon active time. Premium
queries can still keep Neon awake. Actual CU-hour savings require observing the
provider's usage metrics after backend deployment; no savings percentage is
claimed by local tests.

## Android delivery order

Default order: Cloudflare V2 at
`https://astro-download.astrovpnofficial.workers.dev`, then Vercel V2 at
`https://astrovpn.vercel.app`, then the existing Vercel legacy catalog path.
`VITE_V2_PRIMARY_URL` and `VITE_V2_FALLBACK_URL` override the V2 hosts at build
time. Retries sign a fresh nonce. Each V2 attempt has a 12-second deadline,
including its response body.

HTTP 426 stops with the mandatory update prompt; it must not bypass policy via
legacy. Other definitive V2 errors remain handled by the existing client error
path. After all catalog transports fail, the app retains cached servers when
available, otherwise shows an error. Premium still uses Vercel only.

These Android source changes require a new APK build. Existing 1.3.0 APKs built
before this change retain their previous Vercel-first defaults.

## Live checks performed

Signed catalog POSTs using the actual Android request-signing implementation
returned HTTP 200 from **both hosts**, with matching publication generation 13,
matching revision and 23 servers. No raw server configurations or credentials
were printed. This checks publication availability at that moment, not uptime or
compute metrics. An unsigned Vercel GET is not a sufficient health check.

Wrangler authenticated successfully and inspected deployed `astro-download`
version `9b2fbf81-09f1-4a4c-ac28-9872ef075fad` (2026-11-20). Secret names confirmed
Redis URL/token, publication storage key, signing JWK and signing key ID; secret
values were not read or printed. Deployed namespace is `astro-v2` and budget is
240. A signed `/v2/policy` proof accepted on Cloudflare (200) was rejected when
replayed unchanged on Vercel (409 Request replay), confirming working cross-host
replay protection at the time of the check. No deployment was performed.

The older README's "source only; not deployed" heading is obsolete. Its strict
Redis requirement is also not enforced by current code: storage falls back to
process memory when Redis is absent. Matching catalog generations alone do not
prove shared replay/rate-limit state; inspect deployed bindings and test replay
across hosts separately. Do not replace production keys or storage as part of a
traffic-routing change.

## Regression checks

Website: `npm run typecheck` and `node --test server-worker/test/*.test.mjs`.
Android: `npm run typecheck` and `npm run test:v2`.

No deployment, database migration, push or APK rebuild is implied by these
source changes or checks.
