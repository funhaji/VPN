# V2 delivery (source only; not deployed)

Cloudflare `src/index.mjs` and Next.js `/v2/[operation]` use the same gateway,
encrypted publication, installation budget, and replay store. Neither uses an
IP address. A shared Redis REST database is required for cross-host atomicity.
If that authority is unavailable both hosts return 503; fallback cannot bypass it.

## Configuration

Configure identical values on Cloudflare and Vercel:

- `V2_REDIS_REST_URL`: HTTPS Redis REST endpoint supporting EVAL and TIME.
- `V2_REDIS_REST_TOKEN`: restricted database access token.
- `V2_STORAGE_PREFIX`: environment namespace (default `astro-v2`).
- `V2_STORAGE_KEY`: 32 random bytes encoded as unpadded base64url.
- `V2_SIGNING_PRIVATE_JWK`: P-256 private signing JWK, kept server-side.
- `V2_SIGNING_KEY_ID`: identifier for a public key pinned in native clients.
- `V2_INSTALLATION_BUDGET`: token capacity/refill per minute, default 240;
  policy/catalog cost 1, config batches cost their number of servers (1–12).

Primary origin: `https://astro-download.astrovpnofficial.workers.dev`.
The existing `download-worker/src/index.js` dispatches `/v2/*` to this gateway;
deploy the combined download Worker when authorized. The standalone Worker
configuration is optional and has no public workers.dev endpoint or account ID.
No secrets are generated or stored in this repository.

## Publication

Authenticated, same-origin `POST /api/admin/publication` takes
`{ "expectedGeneration": 0, "allServersRemoved": false }` for first publication.
Later publications use the generation from `GET /api/admin/publication`.
All enabled profiles must compile. The encrypted snapshot and policy are
committed together using compare-and-swap. Clients see one complete generation.
Empty publication requires `allServersRemoved: true` on that request, even when
the legacy API's persistent removal toggle is set. Ordinary server/policy edits
remain draft V2 data until publication; automatic publication is not wired yet.

Only display metadata appears in `/v2/catalog`. `/v2/configs` is installation-
authenticated, revision-checked, encrypted to a request-bound ephemeral key,
and server-signed. Signed documents bind nonce, installation, and generation.
Nonce retention is longer than the full request acceptance interval, including
future-dated proofs. Runtime extraction and creating multiple installations
remain possible; this is not hardware app attestation.

Native clients must try Cloudflare first and create a fresh proof for a Vercel
retry following a transport error/5xx. Do not fall back on 400/401/403/409/410/
426/429 or to the legacy API. Pin signing keys, verify request binding, reject
expired documents and generation rollback before using data. The five-minute
document lifetime is transport freshness, not an offline VPN authorization rule.
During blackouts, retain the last verified policy and permit cached connections
if it allows the installed build. A verified block persists offline. No arbitrary
offline grace countdown is applied (user decision).

## Local verification

`node --test server-worker/test/*.test.mjs` exercises signatures, encryption,
request validation, policy denial, metadata boundaries, and publication tamper
handling. Deployment still requires integration checks against the selected
Redis service (Lua support, concurrency, TTL, failure behavior), Cloudflare,
Vercel, and both native clients. No native build/deployment is implied.
