# Premium access enforcement

Only `/api/premium/*` uses the persistent premium IP/device denylist.
Public catalogs, downloads, and heartbeat registration are not IP-blocked by it.

- Android IDs must match `and_` followed by 16 lowercase hex digits.
- Device ID/platform must exist in the `client_devices` table used by Active Users.
- Required proof headers and `x-astro-premium: astro-premium-v1` must be present.
- Signed proof, pinned signing key, timestamp, and nonce checks still apply.
- Credential (`lease`) requests require an active subscription bound to that device.
  Raw subscription keys are supplied only to `redeem`, not on every request.
- Valid free users can request names-only previews and activate an eligible trial.
- Invalid identity, missing required fields, bad proofs, and credential requests
  without entitlement persist IP/device blocks. OPTIONS preflights are exempt.
- Database failures deny access without recording a new ban.

## Source IP

On Vercel, enforcement uses the platform-overwritten `x-vercel-forwarded-for`.
Elsewhere, set `PREMIUM_TRUSTED_IP_HEADER` to the name of a header your reverse
proxy **always overwrites**. Do not configure a pass-through client header.
Without a trusted valid IP, requests are still denied/device-blocked but no IP
ban can be recorded. These are application bans, not edge firewall rules.

## Rollout and recovery

Deploy the updated Android client with registration confirmation before enabling
this website policy for existing users. Older clients can race heartbeat registration.
Devices previously using the exceptional `dev_` fallback now use `and_` and may
need support to restore an existing binding; existing normal Android IDs do not change.

The premium schema creates `premium_access_blocks` automatically. Admin device
unblocking removes denylist entries associated with that device, including its
recorded source IP block. Requests with no device ID can produce IP-only blocks;
these require an authorized database administrator to remove the applicable row.

Immediate bans can affect everyone behind a shared mobile/carrier IP. Missing or
forged identity headers can also cause a claimed device ID to be banned, as this
policy intentionally blocks before authenticating that claim. Active Users is
populated by a public heartbeat, so membership is not cryptographic authentication;
the signed proof and subscription binding remain essential.
