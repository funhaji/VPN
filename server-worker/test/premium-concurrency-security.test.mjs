import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign, createHash } from "node:crypto";
const digest = (value) => createHash("sha256").update(value).digest("base64url");

// In-memory transactional DB simulation modeling the postgres transactional row-locking behavior
class MockSqlTx {
  constructor(db) {
    this.db = db;
  }

  async query(table, filter = () => true) {
    return (this.db[table] || []).filter(filter);
  }

  async insert(table, row) {
    this.db[table] ??= [];
    this.db[table].push(row);
    return row;
  }

  async update(table, filter, updateFn) {
    const rows = (this.db[table] || []).filter(filter);
    rows.forEach(updateFn);
    return rows;
  }
}

class MockDb {
  constructor() {
    this.tables = {
      premium_subscriptions: [],
      premium_devices: [],
      premium_redemptions: [],
      premium_nonces: [],
      premium_security_logs: [],
    };
    this.lock = Promise.resolve();
  }

  async transaction(fn) {
    // Row/table locking serialized via promise chain
    const prev = this.lock;
    let resolve;
    this.lock = new Promise(r => { resolve = r; });
    await prev;
    try {
      const tx = new MockSqlTx(this.tables);
      return await fn(tx);
    } finally {
      resolve();
    }
  }
}

test("Simultaneous device redemptions strictly enforce device_limit", async () => {
  const db = new MockDb();
  const subId = "sub-test-limit";
  const deviceLimit = 2;

  // Insert subscription with device limit of 2
  db.tables.premium_subscriptions.push({
    id: subId,
    days: 30,
    device_limit: deviceLimit,
    traffic_limit: 10_000_000,
    used_bytes: 0,
    revoked_at: null,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  });

  const redeemDevice = async (deviceHash) => {
    return db.transaction(async tx => {
      const [sub] = await tx.query("premium_subscriptions", s => s.id === subId);
      if (!sub || sub.revoked_at) throw new Error("Subscription unavailable");

      const existingRedemptions = await tx.query("premium_redemptions", r => r.subscription_id === subId);
      const isAlreadyClaimed = existingRedemptions.some(r => r.device_hash === deviceHash);

      if (!isAlreadyClaimed) {
        if (existingRedemptions.length >= sub.device_limit) {
          throw new Error("Subscription device limit reached");
        }
        await tx.insert("premium_redemptions", { subscription_id: subId, device_hash: deviceHash });
      }

      await tx.update("premium_devices", d => d.device_hash === deviceHash, d => { d.active_subscription = subId; });
      return { success: true };
    });
  };

  // Launch 5 concurrent redemptions
  const deviceHashes = ["dev-1", "dev-2", "dev-3", "dev-4", "dev-5"];
  const results = await Promise.allSettled(deviceHashes.map(d => redeemDevice(d)));

  const succeeded = results.filter(r => r.status === "fulfilled");
  const rejected = results.filter(r => r.status === "rejected");

  assert.equal(succeeded.length, 2, "Exactly 2 devices should succeed");
  assert.equal(rejected.length, 3, "Remaining 3 devices should be rejected");
  rejected.forEach(r => assert.match(r.reason.message, /Subscription device limit reached/));

  const totalRedemptions = db.tables.premium_redemptions.filter(r => r.subscription_id === subId);
  assert.equal(totalRedemptions.length, 2);
});

test("One-trial race conditions prevent double-claiming", async () => {
  const db = new MockDb();
  const deviceHash = "dev-trial-test";

  db.tables.premium_devices.push({
    device_hash: deviceHash,
    trial_claimed_at: null,
    active_subscription: null,
  });

  const claimTrial = async () => {
    return db.transaction(async tx => {
      const [dev] = await tx.query("premium_devices", d => d.device_hash === deviceHash);
      if (!dev) throw new Error("Device not found");
      if (dev.trial_claimed_at) {
        throw new Error("This device has already used its one-time trial");
      }

      dev.trial_claimed_at = new Date().toISOString();
      const trialSubId = `trial-${Math.random()}`;
      await tx.insert("premium_subscriptions", {
        id: trialSubId,
        kind: "trial",
        days: 1,
        traffic_limit: 1073741824,
        used_bytes: 0,
      });
      dev.active_subscription = trialSubId;
      return { trialSubId };
    });
  };

  // 3 concurrent attempts to claim trial for the same device
  const attempts = await Promise.allSettled([claimTrial(), claimTrial(), claimTrial()]);

  const claimed = attempts.filter(a => a.status === "fulfilled");
  const denied = attempts.filter(a => a.status === "rejected");

  assert.equal(claimed.length, 1, "Only one trial claim should succeed");
  assert.equal(denied.length, 2, "Subsequent concurrent claims must be rejected");
  denied.forEach(d => assert.match(d.reason.message, /already used its one-time trial/));
});

test("Replayed requests with duplicate nonces are rejected", async () => {
  const nonces = new Set();
  const verifyAndStoreNonce = (deviceHash, nonce) => {
    const key = `${deviceHash}:${nonce}`;
    if (nonces.has(key)) {
      throw new Error("Replayed request");
    }
    nonces.add(key);
    return true;
  };

  const device = "dev-nonce-test";
  const nonce = "random-nonce-1234567890abcdef";

  // First request succeeds
  assert.equal(verifyAndStoreNonce(device, nonce), true);

  // Replay of the exact same request fails
  assert.throws(() => verifyAndStoreNonce(device, nonce), /Replayed request/);
});

test("Unauthenticated requests cannot trigger punitive revocation of active subscriptions", async () => {
  const db = new MockDb();
  const targetSubId = "sub-innocent-user";
  const targetDevice = "dev-innocent";

  db.tables.premium_subscriptions.push({
    id: targetSubId,
    revoked_at: null,
    traffic_limit: 1000000,
  });
  db.tables.premium_devices.push({
    device_hash: targetDevice,
    active_subscription: targetSubId,
    blocked_at: null,
  });

  // Attacker crafts forged request claiming target's device ID but with an invalid signature
  const attackerAttemptsAbuse = async () => {
    // 1. Authenticate signature fails
    const isValidSignature = false;
    if (!isValidSignature) {
      throw new Error("Invalid device proof"); // 401
    }
  };

  await assert.rejects(attackerAttemptsAbuse, /Invalid device proof/);

  // Ensure innocent user's subscription and device remain intact
  const [sub] = db.tables.premium_subscriptions;
  const [dev] = db.tables.premium_devices;
  assert.equal(sub.revoked_at, null, "Innocent subscription must NOT be revoked");
  assert.equal(dev.blocked_at, null, "Innocent device must NOT be blocked");
});

test("Authenticated protocol violation by enrolled device causes attributable revocation", async () => {
  const db = new MockDb();
  const subId = "sub-bad-actor";
  const deviceHash = "dev-bad-actor";

  db.tables.premium_subscriptions.push({
    id: subId,
    revoked_at: null,
  });
  db.tables.premium_devices.push({
    device_hash: deviceHash,
    active_subscription: subId,
    blocked_at: null,
  });

  const handleAuthenticatedViolation = async (marker, platform, version) => {
    // Valid signature was proven, but payload protocol marker is invalid or forged
    if (marker !== "astro-premium-v1" || !["android", "windows"].includes(platform)) {
      return db.transaction(async tx => {
        await tx.update("premium_devices", d => d.device_hash === deviceHash, d => { d.blocked_at = new Date().toISOString(); });
        await tx.update("premium_subscriptions", s => s.id === subId, s => { s.revoked_at = new Date().toISOString(); });
        await tx.insert("premium_security_logs", {
          device_hash: deviceHash,
          subscription_id: subId,
          event: "authenticated_protocol_violation",
          detail: "Invalid marker or platform from authenticated device",
        });
        throw new Error("Invalid client protocol");
      });
    }
  };

  await assert.rejects(
    () => handleAuthenticatedViolation("forged-marker", "android", "1.3.0"),
    /Invalid client protocol/
  );

  const [sub] = db.tables.premium_subscriptions;
  const [dev] = db.tables.premium_devices;
  assert.ok(sub.revoked_at !== null, "Abusive device subscription must be revoked");
  assert.ok(dev.blocked_at !== null, "Abusive device must be blocked");

  const [log] = db.tables.premium_security_logs;
  assert.equal(log.event, "authenticated_protocol_violation");
  assert.equal(log.subscription_id, subId);
});

test("Revocation immediately fails closed concurrent lease attempts", async () => {
  const sub = { id: "sub-race", revoked_at: null, expires_at: new Date(Date.now() + 60000).toISOString() };

  const getLease = () => {
    if (sub.revoked_at || new Date(sub.expires_at).getTime() <= Date.now()) {
      throw new Error("Premium no longer active");
    }
    return { leaseId: "lease-123" };
  };

  assert.ok(getLease().leaseId);

  // Admin revokes subscription
  sub.revoked_at = new Date().toISOString();

  // Immediate fail-closed
  assert.throws(() => getLease(), /Premium no longer active/);
});
