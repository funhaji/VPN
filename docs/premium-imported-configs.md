# Premium access for imported provider configs

Premium servers are imported configs supplied by a third-party provider. They do
not require `PREMIUM_CONTROLLER_URL` or `PREMIUM_CONTROLLER_TOKEN`. Those settings
are not read by the premium lease endpoint.

## Deployment

- Keep the existing authoritative premium database and encryption settings.
- Deploy the updated website. Existing encrypted `premium_servers` records work
  without reimporting them or changing their legacy `controller_node` value.
- Add configs through **Premium control → Add private premium server**, or use
  **Premium only** in the server editor. A controller/node ID is not needed.
- Deploy the website before the updated APK: new connections require the lease's
  remaining-byte allowance and the authenticated `usage` renewal operation.

## Credential delivery

The signed, device-authenticated lease endpoint checks the bound subscription,
expiry, recorded quota, device block, and enabled server. It decrypts the private
config and uses the same runtime-profile converters as the ordinary catalog.
Only supported premium runtimes receive a profile; unsupported formats return a
clear error rather than unusable credentials. The endpoint checks entitlement,
subscription binding, and server status again before returning the result.

Responses are private/no-store. Client credential caching remains memory-only.
Each response has a fresh ID and an app-side expiry of at most 60 seconds, capped
by subscription expiry. Inactive users still receive names/countries only in
previews, never configs or connection targets. Premium configs remain excluded
from the public catalog.

## Enforcement limits

The expiry on an API response does **not** expire the provider's underlying
credentials. Revocation blocks subsequent fetches; cooperating apps clear their
credentials and disconnect when they learn of lost entitlement. It cannot force
a modified client or a copied config offline at the provider.

The Android app reports cumulative upload + download bytes from the paid core
outbound every five seconds, in both global Proxy and VPN modes; direct/bypass
traffic is excluded. Native counters continue with the
screen off. Counter snapshots (opaque session ID/bytes only) survive restart and
are retried; the server applies only increases under transactional row locks.
Each new connection gets a fresh accounting session. Final reports still charge
the original subscription after rebinding. At quota exhaustion, usage is capped
at the allowance, expiry is set to now, the account becomes Free, and app-side
credentials are cleared. A native byte ceiling and 60-second verification
deadline disconnect even if the UI cannot renew; paused background JavaScript
can therefore cause a verification disconnect and require reconnection.

These are **app-reported counters, not provider-authoritative billing**. A local
cutoff can overshoot by a sampling interval, and multiple devices can overshoot
between reports. Force-stop, uninstall, tampering or unavailable counters prevent
perfect accounting; unavailable counters fail closed. Accurate provider usage
and revocation of copied credentials require a trusted provider integration.

Validate with an active subscription on a real device: fetch a lease, test actual
outbound delay, connect, revoke, refresh entitlement, and confirm disconnect and
Free account state. Build and unit-test success do not verify provider reachability.
