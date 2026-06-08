"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ServerRecord } from "@/types/server";
import { detectProfileMetadata, splitImportedProfiles } from "@/lib/profile-import";
import { RoutingRulesPanel } from "@/components/routing-rules-panel";

type TabId = "v2ray" | "ssh" | "openvpn" | "wireguard" | "custom" | "bulk" | "routing";
type SshMode = "direct" | "dnstt";
type SshResolverMode = "udp" | "dot" | "doh";
type OpenVpnMode = "tcp" | "udp";

type FormState = {
  name: string;
  country: string;
  host: string;
  port: string;
  rawConfig: string;
  extraJson: string;
  mux: boolean;
  fragment: boolean;
  sniffing: boolean;
  allowInsecure: boolean;
  sshUser: string;
  sshPassword: string;
  sshPrivateKey: string;
  sshPrivateKeyPassphrase: string;
  sshHostKeys: string;
  sshClientVersion: string;
  sshResolver: string;
  dnsttQuerySize: string;
  dnsttMtu: string;
  sshDomain: string;
  sshPublicKey: string;
  sshTunnelPort: string;
  sshLocalPort: string;
  wgLocalAddress: string;
  wgPrivateKey: string;
  wgPeerPublicKey: string;
  wgPresharedKey: string;
  wgAllowedIps: string;
  wgReserved: string;
  wgMtu: string;
  openVpnUsername: string;
  openVpnPassword: string;
};

const BLANK: FormState = {
  name: "",
  country: "",
  host: "",
  port: "",
  rawConfig: "",
  extraJson: "{}",
  mux: false,
  fragment: false,
  sniffing: true,
  allowInsecure: false,
  sshUser: "",
  sshPassword: "",
  sshPrivateKey: "",
  sshPrivateKeyPassphrase: "",
  sshHostKeys: "",
  sshClientVersion: "",
  sshResolver: "8.8.8.8:53",
  dnsttQuerySize: "1232",
  dnsttMtu: "1232",
  sshDomain: "",
  sshPublicKey: "",
  sshTunnelPort: "2222",
  sshLocalPort: "1080",
  wgLocalAddress: "10.0.0.2/32",
  wgPrivateKey: "",
  wgPeerPublicKey: "",
  wgPresharedKey: "",
  wgAllowedIps: "0.0.0.0/0",
  wgReserved: "",
  wgMtu: "1408",
  openVpnUsername: "",
  openVpnPassword: "",
};

const PROTOCOLS: Array<{
  id: TabId;
  label: string;
  badge: string;
  support: string;
}> = [
  { id: "v2ray", label: "V2Ray", badge: "vless / vmess / trojan / ss / hy2", support: "Desktop-ready" },
  { id: "ssh", label: "SSH", badge: "direct / dnstt", support: "Direct ready · DNSTT stored" },
  { id: "wireguard", label: "WireGuard", badge: "structured profile", support: "Stored for rollout" },
  { id: "openvpn", label: "OpenVPN", badge: ".ovpn / inline", support: "Stored for rollout" },
  { id: "custom", label: "Custom", badge: "sing-box / xray / URI", support: "Advanced" },
  { id: "bulk", label: "Bulk", badge: "JSON array import", support: "Import" },
  { id: "routing", label: "Routing Rules", badge: "Iran Direct", support: "Geo IP bypass" },
];

const parseNumber = (value: string): number | undefined => {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const parseExtra = (raw: string): Record<string, string | number | boolean> => {
  const parsed = JSON.parse(raw || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Extra options must be a JSON object");
  }
  return parsed as Record<string, string | number | boolean>;
};

const splitList = (value: string, separator = /[\n,]+/): string[] =>
  value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);

const buildSshDirectConfig = (form: FormState): string =>
  JSON.stringify(
    {
      type: "ssh",
      tag: "proxy",
      server: form.host.trim(),
      server_port: parseNumber(form.port) ?? 22,
      user: form.sshUser.trim() || "root",
      ...(form.sshPassword.trim() ? { password: form.sshPassword.trim() } : {}),
      ...(form.sshPrivateKey.trim() ? { private_key: form.sshPrivateKey.trim() } : {}),
      ...(form.sshPrivateKeyPassphrase.trim()
        ? { private_key_passphrase: form.sshPrivateKeyPassphrase.trim() }
        : {}),
      ...(splitList(form.sshHostKeys).length > 0 ? { host_key: splitList(form.sshHostKeys) } : {}),
      ...(form.sshClientVersion.trim() ? { client_version: form.sshClientVersion.trim() } : {}),
    },
    null,
    2,
  );

const buildSshDnsttProfile = (form: FormState, resolverMode: SshResolverMode): string =>
  JSON.stringify(
    {
      type: "dnstt-ssh",
      ssh: {
        host: form.host.trim(),
        port: parseNumber(form.port) ?? 22,
        user: form.sshUser.trim(),
        ...(form.sshPassword.trim() ? { password: form.sshPassword.trim() } : {}),
      },
      tunnel: {
        transport: resolverMode,
        resolver: form.sshResolver.trim(),
        domain: form.sshDomain.trim(),
        public_key: form.sshPublicKey.trim(),
        local_port: parseNumber(form.sshLocalPort) ?? 1080,
        tunnel_port: parseNumber(form.sshTunnelPort) ?? 2222,
        ...(parseNumber(form.dnsttMtu) ? { mtu: parseNumber(form.dnsttMtu) } : {}),
        ...(parseNumber(form.dnsttQuerySize)
          ? { query_size: parseNumber(form.dnsttQuerySize) }
          : {}),
      },
    },
    null,
    2,
  );

const buildWireGuardProfile = (form: FormState): string =>
  JSON.stringify(
    {
      type: "wireguard-profile",
      endpoint: {
        host: form.host.trim(),
        port: parseNumber(form.port) ?? 51820,
      },
      local_address: splitList(form.wgLocalAddress),
      private_key: form.wgPrivateKey.trim(),
      peer_public_key: form.wgPeerPublicKey.trim(),
      ...(form.wgPresharedKey.trim() ? { pre_shared_key: form.wgPresharedKey.trim() } : {}),
      ...(splitList(form.wgAllowedIps).length > 0 ? { allowed_ips: splitList(form.wgAllowedIps) } : {}),
      ...(splitList(form.wgReserved).length > 0
        ? { reserved: splitList(form.wgReserved).map((item) => Number(item)).filter(Number.isFinite) }
        : {}),
      ...(parseNumber(form.wgMtu) ? { mtu: parseNumber(form.wgMtu) } : {}),
    },
    null,
    2,
  );

const buildOpenVpnProfile = (form: FormState, mode: OpenVpnMode): string =>
  JSON.stringify(
    {
      type: "openvpn-profile",
      transport: mode,
      remote: {
        host: form.host.trim(),
        port: parseNumber(form.port) ?? 1194,
      },
      credentials: {
        username: form.openVpnUsername.trim(),
        password: form.openVpnPassword.trim(),
      },
      profile: form.rawConfig.trim(),
    },
    null,
    2,
  );

const buildImportedPayload = (
  rawConfig: string,
  fallbackProtocol: string,
  form: FormState,
  index = 0,
) => {
  const detected = detectProfileMetadata(rawConfig, fallbackProtocol);
  const explicitName = form.name.trim();
  const explicitCountry = form.country.trim();
  const explicitHost = form.host.trim();
  const explicitPort = parseNumber(form.port);
  const rawName = explicitName
    ? index > 0
      ? `${explicitName} #${index + 1}`
      : explicitName
    : detected.name;
  const safeName = rawName.trim() || `Imported profile #${index + 1}`;
  const rawCountry = explicitCountry || detected.country || detected.host || safeName;
  const safeCountry = rawCountry.trim() || "Imported";

  return {
    name: safeName,
    protocol: detected.protocol,
    country: safeCountry,
    rawConfig: detected.rawConfig,
    isEnabled: true,
    options: {
      mux: form.mux,
      fragment: form.fragment,
      sniffing: form.sniffing,
      allowInsecure: form.allowInsecure,
      extra: parseExtra(form.extraJson),
    },
    ...(explicitHost || detected.host ? { host: explicitHost || detected.host } : {}),
    ...(explicitPort || detected.port ? { port: explicitPort ?? detected.port } : {}),
  };
};

function ToggleChip(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { label, checked, onChange } = props;

  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
        checked
          ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-200"
          : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: string;
}) {
  const { label, value, onChange, placeholder, mono, type = "text" } = props;

  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-cyan-500 ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}

function TextArea(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const { label, value, onChange, rows = 6, placeholder, readOnly } = props;

  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-cyan-500 resize-none font-mono ${readOnly ? "opacity-90" : ""}`}
      />
    </label>
  );
}

export function AdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("v2ray");
  const [form, setForm] = useState<FormState>(BLANK);
  const [variant, setVariant] = useState("vless");
  const [sshMode, setSshMode] = useState<SshMode>("direct");
  const [sshResolverMode, setSshResolverMode] = useState<SshResolverMode>("udp");
  const [openVpnMode, setOpenVpnMode] = useState<OpenVpnMode>("udp");
  const [customProto, setCustomProto] = useState("custom:tcp");
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [stats, setStats] = useState({ total: 0, enabled: 0 });
  const [pendingServerId, setPendingServerId] = useState<string | null>(null);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [serversPage, setServersPage] = useState(0);
  const [dnsttDefaults, setDnsttDefaults] = useState<{ dns: string; querySize: string; mtu: string }>({
    dns: "8.8.8.8:53",
    querySize: "1232",
    mtu: "1232",
  });

  useEffect(() => {
    const raw = localStorage.getItem("astro_admin_dnstt_defaults_v1");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<{ dns: string; querySize: string; mtu: string }>;
      const dns = parsed.dns?.trim();
      const querySize = parsed.querySize?.trim();
      const mtu = parsed.mtu?.trim();
      if (dns) setDnsttDefaults((cur) => ({ ...cur, dns }));
      if (querySize) setDnsttDefaults((cur) => ({ ...cur, querySize }));
      if (mtu) setDnsttDefaults((cur) => ({ ...cur, mtu }));
    } catch {
      // ignore bad localStorage
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("astro_admin_dnstt_defaults_v1", JSON.stringify(dnsttDefaults));
  }, [dnsttDefaults]);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const data = await api<{ servers: ServerRecord[] }>("/api/admin/servers");
      setServers(data.servers);
      setServersPage(0);
      setStats({
        total: data.servers.length,
        enabled: data.servers.filter((server) => server.isEnabled).length,
      });
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : "Load failed" });
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = () => {
    setForm(BLANK);
    setVariant("vless");
    setSshMode("direct");
    setSshResolverMode("udp");
    setOpenVpnMode("udp");
    setCustomProto("custom:tcp");
    setEditingServerId(null);
  };

  const selectSshMode = useCallback(
    (next: SshMode) => {
      setSshMode(next);
      if (next === "dnstt") {
        setForm((current) => ({
          ...current,
          sshResolver: dnsttDefaults.dns,
          dnsttMtu: dnsttDefaults.mtu,
          dnsttQuerySize: dnsttDefaults.querySize,
        }));
      }
    },
    [dnsttDefaults],
  );

  const protocol = useMemo(() => {
    if (tab === "custom") return customProto.trim().toLowerCase();
    if (tab === "ssh") return `ssh:${sshMode}`;
    if (tab === "openvpn") return `openvpn:${openVpnMode}`;
    if (tab === "wireguard") return "wireguard:profile";
    return `${tab}:${variant}`;
  }, [customProto, openVpnMode, sshMode, tab, variant]);

  const PAGE_SIZE = 8;
  const displayedServers = useMemo(
    () => servers.slice(serversPage * PAGE_SIZE, (serversPage + 1) * PAGE_SIZE),
    [servers, serversPage],
  );

  const effectiveRawConfig = useMemo(() => {
    if (tab === "ssh") {
      return sshMode === "direct"
        ? buildSshDirectConfig(form)
        : buildSshDnsttProfile(form, sshResolverMode);
    }
    if (tab === "wireguard") {
      return buildWireGuardProfile(form);
    }
    if (tab === "openvpn") {
      return buildOpenVpnProfile(form, openVpnMode);
    }
    return form.rawConfig.trim();
  }, [form, openVpnMode, sshMode, sshResolverMode, tab]);

  const parsedImportProfiles = useMemo(
    () => (tab === "v2ray" || tab === "custom" ? splitImportedProfiles(effectiveRawConfig) : []),
    [effectiveRawConfig, tab],
  );

  const payloadHost = useMemo(() => {
    if (tab === "ssh" && sshMode === "dnstt") return form.sshDomain.trim();
    return form.host.trim();
  }, [form.host, form.sshDomain, sshMode, tab]);

  const payloadPort = useMemo(() => {
    if (tab === "ssh" && sshMode === "dnstt") return parseNumber(form.sshTunnelPort) ?? 2222;
    return parseNumber(form.port);
  }, [form.port, form.sshTunnelPort, sshMode, tab]);

  const supportTone = useMemo(() => {
    if (tab === "v2ray") {
      return "Paste one share link or multiple share links at once. Names, protocol, host, and port are auto-detected per profile.";
    }
    if (tab === "ssh" && sshMode === "direct") return "Direct SSH can be serialized into sing-box outbound JSON.";
    if (tab === "ssh" && sshMode === "dnstt") return "DNSTT-SSH outbound is stored as-is and executed by the desktop runtime.";
    if (tab === "custom") return "Use this for raw sing-box JSON, xray JSON, or custom URIs. Multiple entries are split when possible.";
    return "This profile is stored cleanly in admin, but the current desktop runtime path is not enabled yet.";
  }, [sshMode, tab]);

  const canSubmit = useMemo(() => {
    if (tab === "bulk") return bulk.trim().length > 0;
    if (tab === "v2ray" || tab === "custom") return effectiveRawConfig.trim().length > 0;
    if (!form.name.trim() || !form.country.trim()) return false;
    if (tab === "ssh" && sshMode === "direct") {
      return Boolean(form.host.trim() && form.port.trim() && form.sshUser.trim() && (form.sshPassword.trim() || form.sshPrivateKey.trim()));
    }
    if (tab === "ssh" && sshMode === "dnstt") {
      return Boolean(form.host.trim() && form.sshUser.trim() && form.sshDomain.trim() && form.sshPublicKey.trim() && form.sshResolver.trim());
    }
    if (tab === "wireguard") {
      return Boolean(form.host.trim() && form.port.trim() && form.wgLocalAddress.trim() && form.wgPrivateKey.trim() && form.wgPeerPublicKey.trim());
    }
    if (tab === "openvpn") {
      return Boolean(form.host.trim() && form.port.trim() && form.rawConfig.trim());
    }
    return effectiveRawConfig.trim().length > 0;
  }, [bulk, effectiveRawConfig, form, sshMode, tab]);

  const submit = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const importableProfiles =
        tab === "v2ray" || tab === "custom" ? splitImportedProfiles(effectiveRawConfig) : [];

      if (!editingServerId && importableProfiles.length > 1) {
        const payloads = importableProfiles.map((entry, index) =>
          buildImportedPayload(entry, protocol, form, index),
        );
        await api("/api/admin/servers", {
          method: "POST",
          body: JSON.stringify({ servers: payloads }),
        });
        setMsg({ ok: true, text: `Imported ${payloads.length} profiles` });
        reset();
        await load();
        return;
      }

      const detected = detectProfileMetadata(effectiveRawConfig.trim(), protocol);
      const payload: Record<string, unknown> = {
        name: form.name.trim() || detected.name,
        protocol: detected.protocol,
        country: form.country.trim() || detected.country,
        rawConfig: effectiveRawConfig.trim(),
        isEnabled: true,
        options: {
          mux: form.mux,
          fragment: form.fragment,
          sniffing: form.sniffing,
          allowInsecure: form.allowInsecure,
          extra: parseExtra(form.extraJson),
        },
      };

      if (payloadHost || detected.host) payload.host = payloadHost || detected.host;
      if (payloadPort || detected.port) payload.port = payloadPort ?? detected.port;

      if (editingServerId) {
        await api(`/api/admin/servers/${editingServerId}`, { method: "PATCH", body: JSON.stringify(payload) });
        setMsg({ ok: true, text: `Server updated successfully` });
      } else {
        await api("/api/admin/servers", { method: "POST", body: JSON.stringify(payload) });
        setMsg({ ok: true, text: `${String(payload.name)} saved successfully` });
      }
      reset();
      await load();
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }, [api, effectiveRawConfig, form, load, payloadHost, payloadPort, protocol, tab]);

  const submitBulk = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      let mapped: Array<Record<string, unknown>> = [];

      try {
        const items = JSON.parse(bulk) as Array<{
          name?: unknown;
          protocol?: unknown;
          variant?: unknown;
          country?: unknown;
          rawConfig?: unknown;
          config?: unknown;
          host?: unknown;
          port?: unknown;
          options?: {
            mux?: unknown;
            fragment?: unknown;
            sniffing?: unknown;
            allowInsecure?: unknown;
            extra?: unknown;
          };
          mux?: unknown;
          fragment?: unknown;
          sniffing?: unknown;
          allowInsecure?: unknown;
          extra?: unknown;
        }>;
        if (!Array.isArray(items) || items.length === 0) {
          throw new Error("Must be a non-empty array");
        }

        mapped = items.map((item, index) => {
          const rawConfig = String(item.rawConfig ?? item.config ?? "").trim();
          const detected = detectProfileMetadata(
            rawConfig,
            String(item.protocol ?? `custom:${item.variant ?? "tcp"}`),
          );

          return {
            name: String(item.name ?? "").trim() || detected.name || `Imported profile #${index + 1}`,
            protocol: String(item.protocol ?? detected.protocol ?? `custom:${item.variant ?? "tcp"}`).toLowerCase(),
            country: String(item.country ?? "").trim() || detected.country,
            rawConfig: detected.rawConfig,
            isEnabled: true,
            options: {
              mux: Boolean(item.options?.mux ?? item.mux),
              fragment: Boolean(item.options?.fragment ?? item.fragment),
              sniffing: Boolean(item.options?.sniffing ?? item.sniffing ?? true),
              allowInsecure: Boolean(item.options?.allowInsecure ?? item.allowInsecure),
              extra: (item.options?.extra ?? item.extra) ?? {},
            },
            ...(item.host || detected.host ? { host: item.host ?? detected.host } : {}),
            ...(item.port || detected.port ? { port: Number(item.port ?? detected.port) } : {}),
          };
        });
      } catch {
        const profiles = splitImportedProfiles(bulk);
        if (profiles.length === 0) {
          throw new Error("Paste a JSON array or one share link per line");
        }
        mapped = profiles.map((entry, index) =>
          buildImportedPayload(entry, "custom:tcp", form, index),
        );
      }

      await api("/api/admin/servers", { method: "POST", body: JSON.stringify({ servers: mapped }) });
      setMsg({ ok: true, text: `Imported ${mapped.length} servers` });
      setBulk("");
      await load();
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : "Bulk import failed" });
    } finally {
      setBusy(false);
    }
  }, [api, bulk, form, load]);

  const toggle = useCallback(async (id: string, isEnabled: boolean) => {
    setPendingServerId(id);
    try {
      await api(`/api/admin/servers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isEnabled }),
      });
      await load();
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : "Toggle failed" });
    } finally {
      setPendingServerId(null);
    }
  }, [api, load]);

  const remove = useCallback(async (id: string) => {
    setPendingServerId(id);
    try {
      await api(`/api/admin/servers/${id}`, { method: "DELETE" });
      await load();
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : "Delete failed" });
    } finally {
      setPendingServerId(null);
    }
  }, [api, load]);

  const logout = async () => {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.refresh();
  };

  const autoSort = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const sorted = [...servers].sort((a, b) => {
        const nameA = a.name || "";
        const nameB = b.name || "";
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
      });
      const orders = sorted.map((s, index) => ({ id: s.id, sort_order: index }));
      await api("/api/admin/servers/reorder", {
        method: "POST",
        body: JSON.stringify(orders),
      });
      setMsg({ ok: true, text: "Auto-sorted successfully" });
      await load();
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : "Sort failed" });
    } finally {
      setBusy(false);
    }
  }, [api, load, servers]);

  const moveServer = useCallback(async (indexInList: number, direction: 'up' | 'down') => {
    if (direction === 'up' && indexInList === 0) return;
    if (direction === 'down' && indexInList === servers.length - 1) return;

    setBusy(true);
    try {
      const newServers = [...servers];
      const targetIndex = direction === 'up' ? indexInList - 1 : indexInList + 1;
      const temp = newServers[indexInList];
      newServers[indexInList] = newServers[targetIndex];
      newServers[targetIndex] = temp;

      const orders = newServers.map((s, idx) => ({ id: s.id, sort_order: idx }));
      await api("/api/admin/servers/reorder", {
        method: "POST",
        body: JSON.stringify(orders),
      });
      await load();
    } catch (error) {
      setMsg({ ok: false, text: "Reorder failed" });
    } finally {
      setBusy(false);
    }
  }, [api, load, servers]);

  const editServer = useCallback(async (id: string) => {
    setPendingServerId(id);
    setMsg(null);
    try {
      const data = await api<{ server: ServerRecord, rawConfig: string }>(`/api/admin/servers/${id}`);
      const s = data.server;
      
      let newTab: TabId = "custom";
      let newVariant = "vless";
      let newCustomProto = "custom:tcp";
      let newSshMode: SshMode = "direct";
      let newSshResolverMode: SshResolverMode = "udp";
      let newOpenVpnMode: OpenVpnMode = "udp";
      
      const proto = s.protocol.toLowerCase();
      if (proto.startsWith("v2ray:")) {
        newTab = "v2ray";
        newVariant = proto.replace("v2ray:", "");
      } else if (proto.startsWith("ssh:")) {
        newTab = "ssh";
        newSshMode = proto.includes("dnstt") ? "dnstt" : "direct";
      } else if (proto.startsWith("wireguard:")) {
        newTab = "wireguard";
      } else if (proto.startsWith("openvpn:")) {
        newTab = "openvpn";
        newOpenVpnMode = proto.includes("tcp") ? "tcp" : "udp";
      } else {
        newTab = "custom";
        newCustomProto = proto;
      }
      
      setTab(newTab);
      setVariant(newVariant);
      setSshMode(newSshMode);
      setOpenVpnMode(newOpenVpnMode);
      setCustomProto(newCustomProto);
      
      if (newTab !== "v2ray" && newTab !== "openvpn") {
        setTab("custom");
        setCustomProto(proto);
      }
      
      setForm({
        ...BLANK,
        name: s.name,
        country: s.country,
        host: s.host,
        port: String(s.port),
        rawConfig: data.rawConfig,
        mux: s.options.mux,
        fragment: s.options.fragment,
        sniffing: s.options.sniffing,
        allowInsecure: s.options.allowInsecure,
        extraJson: JSON.stringify(s.options.extra || {}),
      });
      setEditingServerId(id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setMsg({ ok: false, text: "Failed to load server details" });
    } finally {
      setPendingServerId(null);
    }
  }, [api]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-7xl overflow-hidden rounded-[28px] border border-zinc-800 bg-zinc-950/85 text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
      <aside className="w-72 flex-shrink-0 border-r border-zinc-900 bg-zinc-950/90">
        <div className="border-b border-zinc-900 p-6">
          <div className="rounded-3xl border border-cyan-400/15 bg-[linear-gradient(145deg,rgba(34,211,238,0.14),rgba(10,10,15,0.2))] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300/80">Astro VPN</p>
            <h2 className="mt-3 text-xl font-semibold text-zinc-50">Protocol Studio</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Build profiles that actually match the runtime instead of dumping everything into one raw box.
            </p>
          </div>
        </div>

        <div className="space-y-6 p-5">
          <div>
            <p className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-600">Builders</p>
            <div className="space-y-1.5">
              {PROTOCOLS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setTab(item.id);
                    setMsg(null);
                  }}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    tab === item.id
                      ? "border-cyan-400/50 bg-cyan-400/12 text-zinc-50"
                      : "border-zinc-900 bg-zinc-950 text-zinc-400 hover:border-zinc-800 hover:text-zinc-200"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] opacity-80">
                      {item.support}
                    </span>
                  </div>
                  <p className="mt-1 text-xs opacity-75">{item.badge}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3">
            <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Live servers</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">{stats.enabled}</p>
              <p className="text-sm text-zinc-500">enabled out of {stats.total}</p>
            </div>
            <button
              type="button"
              onClick={() => void autoSort()}
              disabled={busy}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/80 px-4 py-3 text-sm text-zinc-300 transition hover:border-zinc-700 hover:text-zinc-50 disabled:opacity-50"
            >
              Auto sort servers
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={busy}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/80 px-4 py-3 text-sm text-zinc-300 transition hover:border-zinc-700 hover:text-zinc-50 disabled:opacity-50"
            >
              Refresh inventory
            </button>
            <button
              type="button"
              onClick={logout}
              className="rounded-2xl border border-zinc-900 bg-zinc-950 px-4 py-3 text-sm text-zinc-500 transition hover:border-zinc-800 hover:text-zinc-300"
            >
              Lock session
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="border-b border-zinc-900 bg-zinc-950/60 px-8 py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-600">Profile builder</p>
              <h3 className="mt-2 text-2xl font-semibold text-zinc-50">
                {PROTOCOLS.find((item) => item.id === tab)?.label} profile
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{supportTone}</p>
            </div>
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-200">
              <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/80">Stored protocol</div>
              <div className="mt-1 font-mono">{protocol}</div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-8 xl:grid-cols-[minmax(0,1.5fr)_360px]">
          <section className="space-y-6">
            {tab === "routing" ? (
              <RoutingRulesPanel api={api} busy={busy} setBusy={setBusy} setMsg={setMsg} />
            ) : tab !== "bulk" ? (
              <div className="rounded-[28px] border border-zinc-900 bg-zinc-950/70 p-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Server name" value={form.name} onChange={(value) => set("name", value)} placeholder="Germany Premium #1" />
                  <Field label="Country / label" value={form.country} onChange={(value) => set("country", value)} placeholder="Germany" />
                </div>
                {(tab === "v2ray" || tab === "custom") ? (
                  <p className="mt-3 text-xs leading-6 text-zinc-500">
                    Leave these blank to auto-detect from the share link. If you paste multiple profiles, the name is generated per entry.
                  </p>
                ) : null}

                {tab === "v2ray" ? (
                  <div className="mt-6 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {["vless", "vmess", "trojan", "shadowsocks", "hysteria2"].map((item) => (
                        <ToggleChip key={item} label={item} checked={variant === item} onChange={() => setVariant(item)} />
                      ))}
                    </div>
                    <TextArea
                      label="Paste URI or JSON"
                      value={form.rawConfig}
                      onChange={(value) => set("rawConfig", value)}
                      rows={7}
                      placeholder={variant === "vmess" ? "vmess://...\nvmess://..." : variant === "vless" ? "vless://...\nvless://..." : "Paste one share link per line or a raw JSON profile"}
                    />
                    {parsedImportProfiles.length > 1 ? (
                      <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/8 px-4 py-3 text-sm text-cyan-100">
                        {parsedImportProfiles.length} share links detected. Saving will create separate servers automatically.
                      </div>
                    ) : null}
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Optional host override" value={form.host} onChange={(value) => set("host", value)} placeholder="Leave empty to auto-detect" />
                      <Field label="Optional port override" value={form.port} onChange={(value) => set("port", value)} placeholder="443" />
                    </div>
                  </div>
                ) : null}

                {tab === "ssh" ? (
                  <div className="mt-6 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <ToggleChip label="Direct SSH" checked={sshMode === "direct"} onChange={() => selectSshMode("direct")} />
                      <ToggleChip label="SSH over DNSTT" checked={sshMode === "dnstt"} onChange={() => selectSshMode("dnstt")} />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="SSH host / IP" value={form.host} onChange={(value) => set("host", value)} placeholder="203.0.113.5" />
                      <Field label="SSH port" value={form.port} onChange={(value) => set("port", value)} placeholder="22" />
                      <Field label="SSH username" value={form.sshUser} onChange={(value) => set("sshUser", value)} placeholder="root" />
                      <Field label="Password" value={form.sshPassword} onChange={(value) => set("sshPassword", value)} placeholder="Optional when using private key" />
                    </div>

                    {sshMode === "direct" ? (
                      <>
                        <TextArea
                          label="Private key"
                          value={form.sshPrivateKey}
                          onChange={(value) => set("sshPrivateKey", value)}
                          rows={6}
                          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                        />
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field
                            label="Private key passphrase"
                            value={form.sshPrivateKeyPassphrase}
                            onChange={(value) => set("sshPrivateKeyPassphrase", value)}
                            placeholder="Optional"
                          />
                          <Field
                            label="Client version"
                            value={form.sshClientVersion}
                            onChange={(value) => set("sshClientVersion", value)}
                            placeholder="SSH-2.0-OpenSSH_9.6"
                          />
                        </div>
                        <TextArea
                          label="Allowed host keys"
                          value={form.sshHostKeys}
                          onChange={(value) => set("sshHostKeys", value)}
                          rows={4}
                          placeholder="One host key per line. Leave empty to accept any host key."
                        />
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {(["udp", "dot", "doh"] as SshResolverMode[]).map((item) => (
                            <ToggleChip key={item} label={item.toUpperCase()} checked={sshResolverMode === item} onChange={() => setSshResolverMode(item)} />
                          ))}
                        </div>
                        <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/5 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300/80">DNSTT defaults</p>
                              <p className="mt-1 text-xs text-zinc-400">Used to prefill new SSH-DNSTT profiles.</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setForm((current) => ({
                                  ...current,
                                  sshResolver: dnsttDefaults.dns,
                                  dnsttMtu: dnsttDefaults.mtu,
                                  dnsttQuerySize: dnsttDefaults.querySize,
                                }));
                              }}
                              className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:border-cyan-400/60"
                            >
                              Apply defaults
                            </button>
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-3">
                            <Field
                              label="Default DNS resolver"
                              value={dnsttDefaults.dns}
                              onChange={(value) => setDnsttDefaults((cur) => ({ ...cur, dns: value }))}
                              placeholder="8.8.8.8:53 or https://..."
                              mono
                            />
                            <Field
                              label="Default MTU"
                              value={dnsttDefaults.mtu}
                              onChange={(value) => setDnsttDefaults((cur) => ({ ...cur, mtu: value }))}
                              placeholder="1232"
                              mono
                            />
                            <Field
                              label="DNS query size"
                              value={dnsttDefaults.querySize}
                              onChange={(value) => setDnsttDefaults((cur) => ({ ...cur, querySize: value }))}
                              placeholder="1232"
                              mono
                            />
                          </div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="Tunnel domain" value={form.sshDomain} onChange={(value) => set("sshDomain", value)} placeholder="t.example.com" />
                          <Field label="DNSTT public key" value={form.sshPublicKey} onChange={(value) => set("sshPublicKey", value)} placeholder="64 hex chars or full key text" mono />
                          <Field label="DNS resolver target" value={form.sshResolver} onChange={(value) => set("sshResolver", value)} placeholder={sshResolverMode === "doh" ? "https://dns.google/dns-query" : sshResolverMode === "dot" ? "8.8.8.8:853" : "8.8.8.8:53"} mono />
                          <Field label="Remote tunnel port" value={form.sshTunnelPort} onChange={(value) => set("sshTunnelPort", value)} placeholder="2222" />
                          <Field label="Local proxy/listen port" value={form.sshLocalPort} onChange={(value) => set("sshLocalPort", value)} placeholder="1080" />
                          <Field label="DNSTT MTU" value={form.dnsttMtu} onChange={(value) => set("dnsttMtu", value)} placeholder="1232" mono />
                          <Field label="DNS query size" value={form.dnsttQuerySize} onChange={(value) => set("dnsttQuerySize", value)} placeholder="1232" mono />
                        </div>
                        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                          DNSTT requires a separate client/runtime. This panel now stores all required metadata, including the tunnel domain, resolver, and server public key.
                        </div>
                      </>
                    )}
                  </div>
                ) : null}

                {tab === "wireguard" ? (
                  <div className="mt-6 space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Endpoint host" value={form.host} onChange={(value) => set("host", value)} placeholder="162.159.193.10" />
                      <Field label="Endpoint port" value={form.port} onChange={(value) => set("port", value)} placeholder="51820" />
                      <Field label="Local address" value={form.wgLocalAddress} onChange={(value) => set("wgLocalAddress", value)} placeholder="10.0.0.2/32" mono />
                      <Field label="MTU" value={form.wgMtu} onChange={(value) => set("wgMtu", value)} placeholder="1408" />
                    </div>
                    <TextArea label="Private key" value={form.wgPrivateKey} onChange={(value) => set("wgPrivateKey", value)} rows={4} placeholder="Base64 private key" />
                    <TextArea label="Peer public key" value={form.wgPeerPublicKey} onChange={(value) => set("wgPeerPublicKey", value)} rows={3} placeholder="Base64 peer public key" />
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Pre-shared key" value={form.wgPresharedKey} onChange={(value) => set("wgPresharedKey", value)} placeholder="Optional" mono />
                      <Field label="Reserved bytes" value={form.wgReserved} onChange={(value) => set("wgReserved", value)} placeholder="0,0,0" mono />
                    </div>
                    <Field label="Allowed IPs" value={form.wgAllowedIps} onChange={(value) => set("wgAllowedIps", value)} placeholder="0.0.0.0/0, ::/0" mono />
                  </div>
                ) : null}

                {tab === "openvpn" ? (
                  <div className="mt-6 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <ToggleChip label="UDP" checked={openVpnMode === "udp"} onChange={() => setOpenVpnMode("udp")} />
                      <ToggleChip label="TCP" checked={openVpnMode === "tcp"} onChange={() => setOpenVpnMode("tcp")} />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Remote host" value={form.host} onChange={(value) => set("host", value)} placeholder="vpn.example.com" />
                      <Field label="Remote port" value={form.port} onChange={(value) => set("port", value)} placeholder="1194" />
                      <Field label="Profile username" value={form.openVpnUsername} onChange={(value) => set("openVpnUsername", value)} placeholder="Optional" />
                      <Field label="Profile password" value={form.openVpnPassword} onChange={(value) => set("openVpnPassword", value)} placeholder="Optional" />
                    </div>
                    <TextArea
                      label="OpenVPN profile"
                      value={form.rawConfig}
                      onChange={(value) => set("rawConfig", value)}
                      rows={10}
                      placeholder="Paste the .ovpn file contents or inline profile."
                    />
                  </div>
                ) : null}

                {tab === "custom" ? (
                  <div className="mt-6 space-y-4">
                    <Field label="Custom protocol id" value={customProto} onChange={setCustomProto} placeholder="custom:tcp or sing-box:manual" mono />
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Optional host" value={form.host} onChange={(value) => set("host", value)} placeholder="Used for list display and ping" />
                      <Field label="Optional port" value={form.port} onChange={(value) => set("port", value)} placeholder="Used for list display and ping" />
                    </div>
                    <TextArea
                      label="Raw config"
                      value={form.rawConfig}
                      onChange={(value) => set("rawConfig", value)}
                      rows={10}
                      placeholder="Paste sing-box outbound JSON, xray config JSON, or one custom URI per line."
                    />
                    {parsedImportProfiles.length > 1 ? (
                      <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/8 px-4 py-3 text-sm text-cyan-100">
                        {parsedImportProfiles.length} entries detected. Saving will import them as separate profiles.
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-6 rounded-3xl border border-zinc-900 bg-zinc-950/80 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">Routing switches</p>
                      <p className="mt-1 text-xs text-zinc-500">These are stored into protocol options and reused by the desktop app.</p>
                    </div>
                    <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-300">
                      extra options
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <ToggleChip label="Mux" checked={form.mux} onChange={(checked) => set("mux", checked)} />
                    <ToggleChip label="Fragment" checked={form.fragment} onChange={(checked) => set("fragment", checked)} />
                    <ToggleChip label="Sniffing" checked={form.sniffing} onChange={(checked) => set("sniffing", checked)} />
                    <ToggleChip label="Allow insecure" checked={form.allowInsecure} onChange={(checked) => set("allowInsecure", checked)} />
                  </div>
                  <div className="mt-4">
                    <TextArea
                      label="Extra options JSON"
                      value={form.extraJson}
                      onChange={(value) => set("extraJson", value)}
                      rows={4}
                      placeholder='{"packetEncoding":"xudp","serverName":"example.com"}'
                    />
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={busy || !canSubmit}
                    className="rounded-2xl bg-cyan-400 px-6 py-3 text-sm font-semibold text-cyan-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? "Saving..." : editingServerId ? "Update profile" : "Save profile"}
                  </button>
                  {editingServerId && (
                    <button
                      type="button"
                      onClick={() => {
                        reset();
                        setMsg(null);
                      }}
                      className="rounded-2xl border border-zinc-800 bg-zinc-950 px-6 py-3 text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100"
                    >
                      Cancel edit
                    </button>
                  )}
                  {!editingServerId && (
                    <button
                      type="button"
                      onClick={reset}
                      className="rounded-2xl border border-zinc-800 bg-zinc-950 px-6 py-3 text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100"
                    >
                      Reset form
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-[28px] border border-zinc-900 bg-zinc-950/70 p-6">
                <TextArea
                  label="Bulk import"
                  value={bulk}
                  onChange={setBulk}
                  rows={16}
                  placeholder={`vless://...
vmess://...

or

[
  {
    "name": "Germany VLESS",
    "protocol": "v2ray:vless",
    "country": "Germany",
    "rawConfig": "vless://...",
    "options": { "mux": true, "sniffing": true }
  }
]`}
                />
                <p className="mt-3 text-xs leading-6 text-zinc-500">
                  Paste a JSON array or paste one share link per line. Names, protocol, host, and port are auto-detected when possible.
                </p>
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => void submitBulk()}
                    disabled={busy || !bulk.trim()}
                    className="rounded-2xl bg-cyan-400 px-6 py-3 text-sm font-semibold text-cyan-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? "Importing..." : "Import profiles"}
                  </button>
                </div>
              </div>
            )}

            {msg ? (
              <div className={`rounded-2xl border px-4 py-3 text-sm ${msg.ok ? "border-emerald-700/50 bg-emerald-500/10 text-emerald-200" : "border-rose-700/50 bg-rose-500/10 text-rose-200"}`}>
                {msg.text}
              </div>
            ) : null}

            <div className="rounded-[28px] border border-zinc-900 bg-zinc-950/70 p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h4 className="text-lg font-semibold text-zinc-50">Stored servers</h4>
                  <p className="mt-1 text-sm text-zinc-500">Inventory synced from encrypted storage.</p>
                </div>
                <div className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-400">
                  {stats.total} total
                </div>
              </div>
              <div className="grid gap-3">
                {displayedServers.map((server, i) => {
                  const absoluteIndex = serversPage * PAGE_SIZE + i;
                  return (
                  <div key={server.id} className="rounded-2xl border border-zinc-900 bg-zinc-950 px-4 py-4">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-zinc-100">{server.name}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${server.isEnabled ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800 text-zinc-500"}`}>
                            {server.isEnabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500">
                          {server.protocol.toUpperCase()} · {server.country} · {server.host}:{server.port}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void moveServer(absoluteIndex, 'up')}
                          disabled={absoluteIndex === 0 || busy}
                          className="rounded-xl border border-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => void moveServer(absoluteIndex, 'down')}
                          disabled={absoluteIndex === servers.length - 1 || busy}
                          className="rounded-xl border border-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => void editServer(server.id)}
                          disabled={pendingServerId === server.id}
                          className="rounded-xl border border-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggle(server.id, !server.isEnabled)}
                          disabled={pendingServerId === server.id}
                          className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                            server.isEnabled
                              ? "border-emerald-700 text-emerald-300 hover:bg-emerald-500/10"
                              : "border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                          }`}
                        >
                          {pendingServerId === server.id ? "Working..." : server.isEnabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(server.id)}
                          disabled={pendingServerId === server.id}
                          className="rounded-xl border border-rose-700/50 px-3 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10"
                        >
                          {pendingServerId === server.id ? "Working..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  </div>
                )})}
                {servers.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-10 text-center text-sm text-zinc-600">
                    No servers yet — use one of the builders above to create the first profile.
                  </div>
                ) : null}
              </div>

              {stats.total > PAGE_SIZE ? (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => setServersPage((p) => Math.max(0, p - 1))}
                    disabled={serversPage === 0}
                  >
                    Prev
                  </button>
                  <div className="text-xs text-zinc-500">
                    Page {serversPage + 1} / {Math.max(1, Math.ceil(stats.total / PAGE_SIZE))}
                  </div>
                  <button
                    type="button"
                    className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => setServersPage((p) => Math.min(Math.max(0, Math.ceil(stats.total / PAGE_SIZE) - 1), p + 1))}
                    disabled={serversPage >= Math.max(0, Math.ceil(stats.total / PAGE_SIZE) - 1)}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-[28px] border border-zinc-900 bg-zinc-950/70 p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-600">What gets stored</p>
              <h4 className="mt-3 text-lg font-semibold text-zinc-50">Generated payload preview</h4>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                This is the exact raw config encrypted into storage for the current builder.
              </p>
              {tab !== "bulk" ? (
                <div className="mt-4">
                  <TextArea
                    label="Raw config preview"
                    value={effectiveRawConfig}
                    onChange={() => undefined}
                    rows={18}
                    readOnly
                  />
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-zinc-900 bg-zinc-950 px-4 py-6 text-sm text-zinc-500">
                  Bulk mode stores every item exactly as provided in the import array.
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-zinc-900 bg-zinc-950/70 p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-600">Protocol notes</p>
              <div className="mt-4 space-y-4 text-sm leading-6 text-zinc-400">
                <div className="rounded-2xl border border-zinc-900 bg-zinc-950 px-4 py-4">
                  <p className="font-medium text-zinc-200">V2Ray family</p>
                  <p className="mt-1">Paste the full share link or JSON so transport settings stay intact.</p>
                </div>
                <div className="rounded-2xl border border-zinc-900 bg-zinc-950 px-4 py-4">
                  <p className="font-medium text-zinc-200">SSH direct</p>
                  <p className="mt-1">Supports password or private key auth, host key pinning, and custom client version.</p>
                </div>
                <div className="rounded-2xl border border-zinc-900 bg-zinc-950 px-4 py-4">
                  <p className="font-medium text-zinc-200">SSH DNSTT</p>
                  <p className="mt-1">Requires the tunnel domain, resolver target, and the server public key. The panel now stores all of them.</p>
                </div>
                <div className="rounded-2xl border border-zinc-900 bg-zinc-950 px-4 py-4">
                  <p className="font-medium text-zinc-200">WireGuard / OpenVPN</p>
                  <p className="mt-1">These builders now store structured metadata cleanly so the runtime can be added later without re-entering every server.</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
