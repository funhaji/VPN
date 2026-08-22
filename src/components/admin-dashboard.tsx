"use client";

import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ServerRecord } from "@/types/server";
import { detectProfileMetadata, splitImportedProfiles } from "@/lib/profile-import";
import { protocolSupportsCredentials, unwrapOpenVpnProfileContent } from "@/lib/credentials";
import { RoutingRulesPanel } from "@/components/routing-rules-panel";

type TabId = "v2ray" | "ssh" | "openvpn" | "wireguard" | "custom" | "bulk" | "routing" | "http" | "l2tp";
type SshMode = "direct" | "dnstt";
type SshResolverMode = "udp" | "dot" | "doh";
type OpenVpnMode = "tcp" | "udp";
type OpenVpnInputMode = "file" | "paste";

type OvpnFile = {
  id: string;
  name: string;
  content: string;
  selected: boolean;
  username: string;
  password: string;
};

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
  httpUsername: string;
  httpPassword: string;
  l2tpUsername: string;
  l2tpPassword: string;
  l2tpPsk: string;
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
  httpUsername: "",
  httpPassword: "",
  l2tpUsername: "",
  l2tpPassword: "",
  l2tpPsk: "",
};

const PROTOCOLS: Array<{
  id: TabId;
  label: string;
  badge: string;
  support: string;
}> = [
  { id: "v2ray", label: "V2Ray", badge: "vless / vmess / trojan / ss / hy2 / socks", support: "Desktop-ready" },
  { id: "ssh", label: "SSH", badge: "direct / dnstt", support: "Direct ready & DNSTT stored" },
  { id: "http", label: "HTTP", badge: "http proxy", support: "Desktop-ready" },
  { id: "wireguard", label: "WireGuard", badge: "structured profile", support: "Stored for rollout" },
  { id: "openvpn", label: "OpenVPN", badge: ".ovpn / inline", support: "Stored for rollout" },
  { id: "l2tp", label: "L2TP IPsec", badge: "native windows l2tp", support: "Desktop-ready" },
  { id: "custom", label: "Custom", badge: "sing-box / xray / URI", support: "Advanced" },
  { id: "bulk", label: "Bulk", badge: "JSON array import", support: "Import" },
  { id: "routing", label: "Routing Rules", badge: "Iran Direct", support: "Geo IP bypass" },
];

const ISO_REGION_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX",
  "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ",
  "BR", "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK",
  "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM",
  "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS",
  "GT", "GU", "GW", "GY", "HK", "HM", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN",
  "IO", "IQ", "IR", "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN",
  "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV",
  "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ",
  "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI",
  "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM",
  "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC",
  "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV",
  "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR",
  "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
] as const;

const countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });

const flagFromCountryCode = (code: string): string =>
  code
    .toUpperCase()
    .replace(/[A-Z]/g, (letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)));

const COUNTRIES = ISO_REGION_CODES.map((code) => ({
  code,
  flag: flagFromCountryCode(code),
  name: countryDisplayNames.of(code) ?? code,
})).sort((a, b) => a.name.localeCompare(b.name));

const stripLeadingCountryFlag = (value: string): string =>
  value.replace(/^(?:[\u{1F1E6}-\u{1F1FF}]{2}|[\p{Emoji_Presentation}\p{Extended_Pictographic}])\s*/u, "");

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

const parseOvpnRemote = (content: string): { host: string; port: number; transport: string } | null => {
  const match = content.match(/^remote[ \t]+(\S+)[ \t]+(\d+)(?:[ \t]+(udp|tcp))?/im);
  if (!match) return null;
  return { host: match[1], port: Number(match[2]), transport: (match[3] ?? "udp").toLowerCase() };
};

const buildOpenVpnProfile = (form: FormState, mode: OpenVpnMode): string => {
  const profileContent = unwrapOpenVpnProfileContent(form.rawConfig);
  const detected = parseOvpnRemote(profileContent);
  const host = form.host.trim() || detected?.host || "";
  const port = parseNumber(form.port) ?? detected?.port ?? 1194;
  const transport = detected?.transport ?? mode;
  return JSON.stringify(
    {
      type: "openvpn-profile",
      transport,
      remote: { host, port },
      credentials: {
        username: form.openVpnUsername.trim(),
        password: form.openVpnPassword.trim(),
      },
      profile: profileContent,
    },
    null,
    2,
  );
};

const buildHttpProfile = (form: FormState): string =>
  JSON.stringify(
    {
      type: "http",
      server: form.host.trim(),
      server_port: parseNumber(form.port) ?? 8080,
      ...(form.httpUsername.trim() ? { username: form.httpUsername.trim() } : {}),
      ...(form.httpPassword.trim() ? { password: form.httpPassword.trim() } : {}),
    },
    null,
    2,
  );

const buildL2tpProfile = (form: FormState): string =>
  JSON.stringify(
    {
      server: form.host.trim(),
      username: form.l2tpUsername.trim(),
      password: form.l2tpPassword.trim(),
      psk: form.l2tpPsk.trim(),
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

function CountrySelector(props: {
  country: string;
  name: string;
  set: (key: keyof FormState, value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const listId = useId();
  const selectedCountry = COUNTRIES.find((country) => country.code === props.country);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCountries = useMemo(
    () =>
      normalizedQuery
        ? COUNTRIES.filter(
            (country) =>
              country.name.toLowerCase().includes(normalizedQuery) ||
              country.code.toLowerCase().includes(normalizedQuery),
          )
        : COUNTRIES,
    [normalizedQuery],
  );

  const chooseCountry = (country: (typeof COUNTRIES)[number]) => {
    props.set("country", country.code);
    if (props.name) {
      props.set("name", `${country.flag} ${stripLeadingCountryFlag(props.name)}`);
    }
    setQuery("");
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <span className="mb-1 block text-xs text-zinc-500">Country (adds flag to name)</span>
      <input
        type="text"
        value={isOpen ? query : selectedCountry ? `${selectedCountry.flag} ${selectedCountry.name}` : props.country}
        onFocus={() => {
          setIsOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onBlur={() => setIsOpen(false)}
        placeholder="Search countries..."
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-cyan-500"
      />
      {isOpen ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-1 shadow-2xl shadow-black/40"
        >
          {filteredCountries.length > 0 ? (
            filteredCountries.map((country) => (
              <button
                key={country.code}
                type="button"
                role="option"
                aria-selected={country.code === props.country}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => chooseCountry(country)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                  country.code === props.country
                    ? "bg-cyan-400/12 text-cyan-100"
                    : "text-zinc-200 hover:bg-white/6"
                }`}
              >
                <span className="min-w-0 truncate">
                  <span className="mr-2">{country.flag}</span>
                  {country.name}
                </span>
                <span className="font-mono text-xs text-zinc-500">{country.code}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-4 text-sm text-zinc-500">No countries found</div>
          )}
        </div>
      ) : null}
    </div>
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
  const [openVpnInputMode, setOpenVpnInputMode] = useState<OpenVpnInputMode>("paste");
  const [ovpnFiles, setOvpnFiles] = useState<OvpnFile[]>([]);
  const [ovpnBulkUsername, setOvpnBulkUsername] = useState("");
  const [ovpnBulkPassword, setOvpnBulkPassword] = useState("");
  const [ovpnDragging, setOvpnDragging] = useState(false);
  const ovpnFileInputRef = useRef<HTMLInputElement>(null);
  const [customProto, setCustomProto] = useState("custom:tcp");
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [stats, setStats] = useState({ total: 0, enabled: 0 });
  const [pendingServerId, setPendingServerId] = useState<string | null>(null);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [serversPage, setServersPage] = useState(0);
  const [selectedServerIds, setSelectedServerIds] = useState<Set<string>>(new Set());
  const [bulkCredUsername, setBulkCredUsername] = useState("");
  const [bulkCredPassword, setBulkCredPassword] = useState("");
  const [bulkCredPsk, setBulkCredPsk] = useState("");
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

  const handleOvpnFiles = useCallback(async (files: File[]) => {
    const loaded = await Promise.all(
      files.map(async (file): Promise<OvpnFile> => {
        const content = await file.text();
        const name = file.name.replace(/\.ovpn$/i, "");
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: name || file.name,
          content,
          selected: true,
          username: "",
          password: "",
        };
      }),
    );
    setOvpnFiles((prev) => {
      const existingContents = new Set(prev.map((f) => f.content));
      const fresh = loaded.filter((f) => !existingContents.has(f.content));
      return [...prev, ...fresh];
    });
  }, []);

  const reset = useCallback((keepFields?: boolean) => {
    if (keepFields) {
      setForm((prev) => ({
        ...BLANK,
        name: prev.name,
        country: prev.country,
        host: prev.host,
        port: prev.port,
        httpUsername: prev.httpUsername,
        httpPassword: prev.httpPassword,
        sshUser: prev.sshUser,
        sshPassword: prev.sshPassword,
        openVpnUsername: prev.openVpnUsername,
        openVpnPassword: prev.openVpnPassword,
      }));
    } else {
      setForm(BLANK);
      setVariant("vless");
      setSshMode("direct");
      setSshResolverMode("udp");
      setOpenVpnMode("udp");
      setOvpnFiles([]);
      setCustomProto("custom:tcp");
    }
    setEditingServerId(null);
  }, []);

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
    if (tab === "http") return "http";
    if (tab === "l2tp") return "l2tp";
    return `${tab}:${variant}`;
  }, [customProto, openVpnMode, sshMode, tab, variant]);

  const PAGE_SIZE = 8;
  const displayedServers = useMemo(
    () => servers.slice(serversPage * PAGE_SIZE, (serversPage + 1) * PAGE_SIZE),
    [servers, serversPage],
  );

  const credentialServers = useMemo(
    () => servers.filter((server) => protocolSupportsCredentials(server.protocol)),
    [servers],
  );

  const selectedCredentialCount = useMemo(
    () => credentialServers.filter((server) => selectedServerIds.has(server.id)).length,
    [credentialServers, selectedServerIds],
  );

  const toggleServerSelection = useCallback((id: string, checked: boolean) => {
    setSelectedServerIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleAllCredentialServers = useCallback((checked: boolean) => {
    setSelectedServerIds((current) => {
      const next = new Set(current);
      for (const server of credentialServers) {
        if (checked) next.add(server.id);
        else next.delete(server.id);
      }
      return next;
    });
  }, [credentialServers]);

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
    if (tab === "http") {
      return buildHttpProfile(form);
    }
    if (tab === "l2tp") {
      return buildL2tpProfile(form);
    }
    return form.rawConfig.trim();
  }, [form, openVpnMode, sshMode, sshResolverMode, tab]);

  // Deferred so the big JSON preview doesn't block keystrokes
  const deferredEffectiveRawConfig = useDeferredValue(effectiveRawConfig);

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
    if (tab === "http") return "Standard HTTP proxy outbound for sing-box/xray.";
    return "This profile is stored cleanly in admin, but the current desktop runtime path is not enabled yet.";
  }, [sshMode, tab]);

  const canSubmit = useMemo(() => {
    if (tab === "bulk") return bulk.trim().length > 0;
    if (tab === "v2ray" || tab === "custom") return effectiveRawConfig.trim().length > 0;
    if (tab === "openvpn" && openVpnInputMode === "file") {
      return ovpnFiles.some((file) => file.selected);
    }
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
      const detectedRemote = parseOvpnRemote(form.rawConfig);
      return Boolean(form.name.trim() && form.rawConfig.trim() && (form.host.trim() || detectedRemote));
    }
    if (tab === "http") {
      return Boolean(form.host.trim() && form.port.trim());
    }
    if (tab === "l2tp") {
      return Boolean(form.host.trim() && form.l2tpUsername.trim() && form.l2tpPassword.trim() && form.l2tpPsk.trim());
    }
    return effectiveRawConfig.trim().length > 0;
  }, [bulk, effectiveRawConfig, form, openVpnInputMode, ovpnFiles, sshMode, tab]);

  const submit = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      // ── OpenVPN file-upload bulk submit ──────────────────────────────────
      if (tab === "openvpn" && openVpnInputMode === "file") {
        const selectedFiles = ovpnFiles.filter((file) => file.selected);
        if (selectedFiles.length === 0) {
          throw new Error("Select at least one OpenVPN file");
        }
        const payloads = selectedFiles.map((file) => {
          const detected = parseOvpnRemote(file.content);
          const transport = detected?.transport ?? openVpnMode;
          const username = file.username || ovpnBulkUsername;
          const password = file.password || ovpnBulkPassword;
          const rawConfig = JSON.stringify({
            type: "openvpn-profile",
            transport,
            remote: {
              host: detected?.host ?? "embedded-config",
              port: detected?.port ?? 1194,
            },
            credentials: { username, password },
            profile: file.content,
          });
          const safeName = (file.name || `OpenVPN ${detected?.host ?? "Config"}`).trim();
          return {
            name: safeName.length >= 2 ? safeName : `${safeName} Config`,
            protocol: `openvpn:${transport}`,
            country: safeName.length >= 2 ? safeName : "Imported",
            rawConfig,
            isEnabled: true,
            options: { mux: false, fragment: false, sniffing: false, allowInsecure: false, extra: {} },
            host: detected?.host ?? "embedded-config",
            port: detected?.port ?? 1194,
          };
        });
        await api("/api/admin/servers", {
          method: "POST",
          body: JSON.stringify({ servers: payloads }),
        });
        setMsg({ ok: true, text: `Imported ${payloads.length} OpenVPN profile${payloads.length !== 1 ? "s" : ""}` });
        setOvpnFiles([]);
        await load();
        return;
      }
      // ── End OpenVPN file-upload ──────────────────────────────────────────

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
        reset(false);
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
        reset(false);
      } else {
        await api("/api/admin/servers", { method: "POST", body: JSON.stringify(payload) });
        setMsg({ ok: true, text: `${String(payload.name)} saved successfully` });
        reset(true);
      }
      await load();
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }, [api, editingServerId, effectiveRawConfig, form, load, openVpnInputMode, openVpnMode, ovpnBulkPassword, ovpnBulkUsername, ovpnFiles, payloadHost, payloadPort, protocol, tab, reset]);

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

  const bulkServerAction = useCallback(async (action: "enable-all" | "disable-all" | "delete-all") => {
    if (action === "delete-all" && !window.confirm("Delete every stored server? This cannot be undone.")) {
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      if (action === "delete-all") {
        const res = await api<{ deleted: number }>("/api/admin/servers", { method: "DELETE" });
        setSelectedServerIds(new Set());
        setMsg({ ok: true, text: `Deleted ${res.deleted} servers` });
      } else {
        const res = await api<{ changed: number }>("/api/admin/servers", {
          method: "PATCH",
          body: JSON.stringify({ action }),
        });
        setMsg({
          ok: true,
          text: `${action === "enable-all" ? "Enabled" : "Disabled"} ${res.changed} servers`,
        });
      }
      await load();
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : "Bulk action failed" });
    } finally {
      setBusy(false);
    }
  }, [api, load]);

  const bulkUpdateCredentials = useCallback(async () => {
    const ids = credentialServers
      .filter((server) => selectedServerIds.has(server.id))
      .map((server) => server.id);
    if (ids.length === 0) {
      setMsg({ ok: false, text: "Select at least one OpenVPN, HTTP, SSH, or L2TP server" });
      return;
    }
    if (!bulkCredUsername.trim() && !bulkCredPassword.trim() && !bulkCredPsk.trim()) {
      setMsg({ ok: false, text: "Enter a username, password, and/or PSK to apply" });
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ updated: number; warnings?: string[] }>("/api/admin/servers", {
        method: "PATCH",
        body: JSON.stringify({
          action: "update-credentials",
          ids,
          username: bulkCredUsername,
          password: bulkCredPassword,
          psk: bulkCredPsk,
        }),
      });
      const warningText =
        res.warnings && res.warnings.length > 0 ? ` (${res.warnings.length} skipped with warnings)` : "";
      setMsg({
        ok: true,
        text: `Updated credentials on ${res.updated} server${res.updated === 1 ? "" : "s"}${warningText}`,
      });
      setBulkCredUsername("");
      setBulkCredPassword("");
      setBulkCredPsk("");
      setSelectedServerIds(new Set());
      await load();
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : "Bulk credential update failed" });
    } finally {
      setBusy(false);
    }
  }, [api, bulkCredPassword, bulkCredUsername, bulkCredPsk, credentialServers, load, selectedServerIds]);

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
    } catch {
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
      } else if (proto === "http") {
        newTab = "http";
      } else if (proto === "l2tp") {
        newTab = "l2tp";
      } else {
        newTab = "custom";
        newCustomProto = proto;
      }
      
      setTab(newTab);
      setVariant(newVariant);
      setSshMode(newSshMode);
      setOpenVpnMode(newOpenVpnMode);
      setCustomProto(newCustomProto);
      
      if (newTab !== "v2ray" && newTab !== "openvpn" && newTab !== "http" && newTab !== "ssh" && newTab !== "wireguard" && newTab !== "l2tp") {
        setTab("custom");
        setCustomProto(proto);
      }

      let httpUsername = "";
      let httpPassword = "";
      let openVpnUsername = "";
      let openVpnPassword = "";
      let l2tpUsername = "";
      let l2tpPassword = "";
      let l2tpPsk = "";
      let rawConfig = data.rawConfig;

      if (newTab === "http") {
        try {
          const parsed = JSON.parse(data.rawConfig);
          httpUsername = parsed.username || "";
          httpPassword = parsed.password || "";
        } catch {
          // ignore
        }
      }
      
      if (newTab === "l2tp") {
        try {
          const parsed = JSON.parse(data.rawConfig);
          l2tpUsername = parsed.username || "";
          l2tpPassword = parsed.password || "";
          l2tpPsk = parsed.psk || "";
        } catch {
          // ignore
        }
      }

      if (newTab === "openvpn") {
        try {
          const parsed = JSON.parse(data.rawConfig);
          if (parsed?.type === "openvpn-profile") {
            rawConfig = unwrapOpenVpnProfileContent(data.rawConfig);
            openVpnUsername = parsed.credentials?.username || "";
            openVpnPassword = parsed.credentials?.password || "";
          }
        } catch {
          // ignore
        }
      }
      
      setForm({
        ...BLANK,
        name: s.name,
        country: s.country,
        host: s.host,
        port: String(s.port),
        rawConfig,
        httpUsername,
        httpPassword,
        l2tpUsername,
        l2tpPassword,
        l2tpPsk,
        openVpnUsername,
        openVpnPassword,
        mux: s.options.mux,
        fragment: s.options.fragment,
        sniffing: s.options.sniffing,
        allowInsecure: s.options.allowInsecure,
        extraJson: JSON.stringify(s.options.extra || {}),
      });
      setEditingServerId(id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setMsg({ ok: false, text: "Failed to load server details" });
    } finally {
      setPendingServerId(null);
    }
  }, [api]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] overflow-hidden rounded-[24px] border border-white/6 bg-zinc-950/80 text-zinc-100 shadow-2xl backdrop-blur-xl">
      {/* Sidebar */}
      <aside className="flex w-52 flex-shrink-0 flex-col border-r border-white/5 bg-black/20">
        {/* Protocol nav */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {PROTOCOLS.map((item) => {
            const isActive = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { setTab(item.id); setMsg(null); }}
                className={`group w-full rounded-lg px-3 py-2 text-left transition-all ${
                  isActive ? "bg-white/8 ring-1 ring-white/10" : "hover:bg-white/4"
                }`}
              >
                <span className={`text-sm font-medium transition ${isActive ? "text-zinc-50" : "text-zinc-400 group-hover:text-zinc-200"}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Stats + actions */}
        <div className="border-t border-white/5 px-3 py-3 space-y-2">
          {/* Server count */}
          <div className="rounded-xl border border-white/6 bg-white/3 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Live servers</p>
              <span className="text-xs text-zinc-400">{stats.enabled}/{stats.total}</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all"
                style={{ width: stats.total > 0 ? `${(stats.enabled / stats.total) * 100}%` : "0%" }}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void autoSort()}
              disabled={busy}
              className="rounded-xl border border-white/8 bg-white/3 px-3 py-2 text-xs text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:opacity-40"
            >
              Auto sort
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={busy}
              className="rounded-xl border border-white/8 bg-white/3 px-3 py-2 text-xs text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 disabled:opacity-40"
            >
              Refresh
            </button>
          </div>
          <button
            type="button"
            onClick={logout}
            className="w-full rounded-xl border border-rose-900/40 px-3 py-2 text-xs text-rose-500/80 transition hover:border-rose-700/50 hover:text-rose-400"
          >
            Lock session
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="border-b border-white/5 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-base font-semibold text-zinc-100">
              {PROTOCOLS.find((item) => item.id === tab)?.label}
            </h3>
            <span className="rounded-full border border-white/8 px-3 py-1 font-mono text-xs text-zinc-400">{protocol}</span>
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
                  <CountrySelector country={form.country} name={form.name} set={set} />
                </div>
                {(tab === "v2ray" || tab === "custom") ? (
                  <p className="mt-3 text-xs leading-6 text-zinc-500">
                    Leave these blank to auto-detect from the share link. If you paste multiple profiles, the name is generated per entry.
                  </p>
                ) : null}

                {tab === "v2ray" ? (
                  <div className="mt-6 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {["vless", "vmess", "trojan", "shadowsocks", "hysteria2", "socks"].map((item) => (
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
                  <div className="mt-6 space-y-5">
                    {/* Mode + transport toggles */}
                    <div className="flex flex-wrap items-center gap-2">
                      <ToggleChip label="Upload .ovpn files" checked={openVpnInputMode === "file"} onChange={() => { setOpenVpnInputMode("file"); }} />
                      <ToggleChip label="Paste config" checked={openVpnInputMode === "paste"} onChange={() => setOpenVpnInputMode("paste")} />
                      <span className="h-5 w-px bg-zinc-800" />
                      <ToggleChip label="UDP" checked={openVpnMode === "udp"} onChange={() => setOpenVpnMode("udp")} />
                      <ToggleChip label="TCP" checked={openVpnMode === "tcp"} onChange={() => setOpenVpnMode("tcp")} />
                    </div>

                    {openVpnInputMode === "file" ? (
                      <div className="space-y-4">
                        {/* Drop zone */}
                        <div
                          onDragOver={(e) => { e.preventDefault(); setOvpnDragging(true); }}
                          onDragLeave={() => setOvpnDragging(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setOvpnDragging(false);
                            const files = Array.from(e.dataTransfer.files).filter((f) => f.name.toLowerCase().endsWith(".ovpn"));
                            void handleOvpnFiles(files);
                          }}
                          onClick={() => ovpnFileInputRef.current?.click()}
                          className={`cursor-pointer select-none rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
                            ovpnDragging
                              ? "border-cyan-400/80 bg-cyan-400/10"
                              : "border-zinc-700 hover:border-zinc-600 hover:bg-zinc-900/40"
                          }`}
                        >
                          <input
                            ref={ovpnFileInputRef}
                            type="file"
                            accept=".ovpn"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                              const files = Array.from(e.target.files ?? []);
                              void handleOvpnFiles(files);
                              e.target.value = "";
                            }}
                          />
                          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-400 text-lg">
                            ↑
                          </div>
                          <p className="text-sm font-medium text-zinc-300">Drop .ovpn files here or click to browse</p>
                          <p className="mt-1 text-xs text-zinc-600">Multiple files supported — filename becomes the config name</p>
                        </div>

                        {ovpnFiles.length > 0 && (
                          <div className="space-y-3">
                            {/* Select-all header */}
                            <div className="flex items-center justify-between gap-3 px-1">
                              <label className="flex cursor-pointer items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="accent-cyan-400"
                                  checked={ovpnFiles.every((f) => f.selected)}
                                  onChange={(e) =>
                                    setOvpnFiles((prev) => prev.map((f) => ({ ...f, selected: e.target.checked })))
                                  }
                                />
                                <span className="text-xs text-zinc-400">
                                  {ovpnFiles.filter((f) => f.selected).length} of {ovpnFiles.length} selected
                                </span>
                              </label>
                              <button
                                type="button"
                                onClick={() => setOvpnFiles([])}
                                className="text-xs text-zinc-600 transition hover:text-rose-400"
                              >
                                Clear all
                              </button>
                            </div>

                            {/* File rows */}
                            <div className="space-y-2">
                              {ovpnFiles.map((file) => {
                                const detectedR = parseOvpnRemote(file.content);
                                return (
                                  <div
                                    key={file.id}
                                    className={`rounded-2xl border px-4 py-3 transition ${
                                      file.selected
                                        ? "border-cyan-400/30 bg-cyan-400/5"
                                        : "border-zinc-800 bg-zinc-950"
                                    }`}
                                  >
                                    <div className="flex items-center gap-3">
                                      <input
                                        type="checkbox"
                                        className="flex-shrink-0 accent-cyan-400"
                                        checked={file.selected}
                                        onChange={(e) =>
                                          setOvpnFiles((prev) =>
                                            prev.map((f) =>
                                              f.id === file.id ? { ...f, selected: e.target.checked } : f,
                                            ),
                                          )
                                        }
                                      />
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium text-zinc-100">{file.name}</p>
                                        {detectedR ? (
                                          <p className="mt-0.5 text-xs text-zinc-600">
                                            {detectedR.host}:{detectedR.port} · {detectedR.transport.toUpperCase()}
                                          </p>
                                        ) : (
                                          <p className="mt-0.5 text-xs text-amber-600/80">No remote directive detected</p>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => setOvpnFiles((prev) => prev.filter((f) => f.id !== file.id))}
                                        className="flex-shrink-0 px-1 text-zinc-600 transition hover:text-rose-400"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Bulk credentials panel — only shown when ≥1 file is selected */}
                            {ovpnFiles.some((f) => f.selected) && (
                              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5 space-y-4">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/80">Credentials</p>
                                  <p className="mt-0.5 text-xs text-zinc-500">
                                    Used for the selected uploaded profile{ovpnFiles.filter((f) => f.selected).length === 1 ? "" : "s"} when you click Save profile.
                                  </p>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                  <label className="block">
                                    <span className="mb-1 block text-xs text-zinc-500">Username</span>
                                    <input
                                      type="text"
                                      value={ovpnBulkUsername}
                                      onChange={(e) => setOvpnBulkUsername(e.target.value)}
                                      placeholder="VPN username (optional)"
                                      className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-cyan-500"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="mb-1 block text-xs text-zinc-500">Password</span>
                                    <input
                                      type="text"
                                      value={ovpnBulkPassword}
                                      onChange={(e) => setOvpnBulkPassword(e.target.value)}
                                      placeholder="VPN password (optional)"
                                      className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-cyan-500"
                                    />
                                  </label>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Paste mode */
                      <div className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="Config name" value={form.name} onChange={(value) => set("name", value)} placeholder="My OpenVPN Server" />
                          <CountrySelector country={form.country} name={form.name} set={set} />
                          <Field label="Username (optional)" value={form.openVpnUsername} onChange={(value) => set("openVpnUsername", value)} placeholder="VPN username" />
                          <Field label="Password (optional)" value={form.openVpnPassword} onChange={(value) => set("openVpnPassword", value)} placeholder="VPN password" />
                        </div>
                        <TextArea
                          label="Paste .ovpn config"
                          value={form.rawConfig}
                          onChange={(value) => set("rawConfig", value)}
                          rows={12}
                          placeholder={"dev tun\n\nremote 188.132.173.34 443 udp\n\n<ca>\n-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n</ca>\n\n<tls-auth>\n...\n</tls-auth>"}
                        />
                        {parseOvpnRemote(form.rawConfig) ? (
                          <div className="rounded-2xl border border-emerald-700/30 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-200">
                            ✓ Remote detected:{" "}
                            <span className="font-mono">
                              {parseOvpnRemote(form.rawConfig)!.host}:{parseOvpnRemote(form.rawConfig)!.port}
                            </span>
                            {" ·"} {parseOvpnRemote(form.rawConfig)!.transport.toUpperCase()}
                          </div>
                        ) : form.rawConfig.trim() ? (
                          <div className="rounded-2xl border border-amber-700/30 bg-amber-500/8 px-4 py-3 text-sm text-amber-200">
                            ⚠ No <span className="font-mono">remote</span> directive found — add a host in the field below or check the config.
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              <Field label="Remote host (override)" value={form.host} onChange={(value) => set("host", value)} placeholder="vpn.example.com" />
                              <Field label="Remote port (override)" value={form.port} onChange={(value) => set("port", value)} placeholder="1194" />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}

                {tab === "http" ? (
                  <div className="mt-6 space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Proxy host / IP" value={form.host} onChange={(value) => set("host", value)} placeholder="192.168.1.1" />
                      <Field label="Proxy port" value={form.port} onChange={(value) => set("port", value)} placeholder="8080" />
                      <Field label="Username (Optional)" value={form.httpUsername} onChange={(value) => set("httpUsername", value)} placeholder="Optional" />
                      <Field label="Password (Optional)" value={form.httpPassword} onChange={(value) => set("httpPassword", value)} placeholder="Optional" />
                    </div>
                  </div>
                ) : null}

                {tab === "l2tp" ? (
                  <div className="mt-6 space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Server host / IP" value={form.host} onChange={(value) => set("host", value)} placeholder="vpn.example.com" />
                      <Field label="IPsec Pre-Shared Key (PSK)" value={form.l2tpPsk} onChange={(value) => set("l2tpPsk", value)} placeholder="IPsec PSK" />
                      <Field label="Username" value={form.l2tpUsername} onChange={(value) => set("l2tpUsername", value)} placeholder="L2TP Username" />
                      <Field label="Password" value={form.l2tpPassword} onChange={(value) => set("l2tpPassword", value)} placeholder="L2TP Password" />
                    </div>
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
                        reset(false);
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
                      onClick={() => reset(false)}
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
              <div className="mb-4 flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-zinc-100">Stored servers <span className="ml-1 text-zinc-600">({stats.total})</span></h4>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void bulkServerAction("enable-all")}
                    disabled={busy || stats.total === 0}
                    className="rounded-xl border border-emerald-700/50 px-3 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Enable all
                  </button>
                  <button
                    type="button"
                    onClick={() => void bulkServerAction("disable-all")}
                    disabled={busy || stats.total === 0}
                    className="rounded-xl border border-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Disable all
                  </button>
                  <button
                    type="button"
                    onClick={() => void bulkServerAction("delete-all")}
                    disabled={busy || stats.total === 0}
                    className="rounded-xl border border-rose-700/50 px-3 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Delete all
                  </button>
                </div>
              </div>

              {credentialServers.length > 0 ? (
                <div className="mb-4 rounded-2xl border border-white/6 bg-white/3 px-5 py-4">
                  {/* Header row: checkbox + button */}
                  <div className="flex items-start justify-between gap-4">
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={
                          credentialServers.length > 0 &&
                          credentialServers.every((server) => selectedServerIds.has(server.id))
                        }
                        onChange={(e) => toggleAllCredentialServers(e.target.checked)}
                        className="rounded border-zinc-700 bg-zinc-900 accent-cyan-400"
                      />
                      <div>
                        <p className="text-sm font-medium text-zinc-200">Bulk credentials</p>
                        <p className="text-xs text-zinc-500">
                          {selectedCredentialCount} of {credentialServers.length} selected · OpenVPN, HTTP, SSH, L2TP
                        </p>
                      </div>
                    </label>
                    <button
                      type="button"
                      onClick={() => void bulkUpdateCredentials()}
                      disabled={busy || selectedCredentialCount === 0}
                      className="flex-shrink-0 rounded-xl bg-cyan-400 px-4 py-2 text-xs font-semibold text-cyan-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busy ? "Updating..." : "Update selected"}
                    </button>
                  </div>
                  {/* Fields row - below the header */}
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <Field
                      label="Bulk username"
                      value={bulkCredUsername}
                      onChange={setBulkCredUsername}
                      placeholder="Leave blank to keep"
                    />
                    <Field
                      label="Bulk password"
                      value={bulkCredPassword}
                      onChange={setBulkCredPassword}
                      placeholder="Leave blank to keep"
                      type="password"
                    />
                    <Field
                      label="L2TP PSK (L2TP only)"
                      value={bulkCredPsk}
                      onChange={setBulkCredPsk}
                      placeholder="Leave blank to keep"
                    />
                  </div>
                </div>
              ) : null}

              <div className="grid gap-2">
                {displayedServers.map((server, i) => {
                  const absoluteIndex = serversPage * PAGE_SIZE + i;
                  const supportsCredentials = protocolSupportsCredentials(server.protocol);
                  const protoBadgeColor = (() => {
                    const p = server.protocol.toLowerCase();
                    if (p.startsWith("v2ray") || p.startsWith("vless") || p.startsWith("vmess") || p.startsWith("trojan") || p.startsWith("ss:") || p.startsWith("hysteria")) return "bg-cyan-500/15 text-cyan-300";
                    if (p.startsWith("ssh")) return "bg-purple-500/15 text-purple-300";
                    if (p.startsWith("openvpn")) return "bg-orange-500/15 text-orange-300";
                    if (p.startsWith("wireguard") || p === "wg") return "bg-blue-500/15 text-blue-300";
                    if (p.startsWith("l2tp")) return "bg-emerald-500/15 text-emerald-300";
                    if (p === "http") return "bg-rose-500/15 text-rose-300";
                    return "bg-zinc-800 text-zinc-400";
                  })();
                  return (
                  <div key={server.id} className="group rounded-xl border border-white/5 bg-white/3 px-4 py-3 transition hover:border-white/8 hover:bg-white/4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        {supportsCredentials ? (
                          <input
                            type="checkbox"
                            checked={selectedServerIds.has(server.id)}
                            onChange={(e) => toggleServerSelection(server.id, e.target.checked)}
                            className="mt-0.5 rounded border-zinc-700 bg-zinc-900 accent-cyan-400"
                            aria-label={`Select ${server.name}`}
                          />
                        ) : (
                          <span className="mt-0.5 inline-block h-4 w-4" aria-hidden="true" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-zinc-100">{server.name}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${protoBadgeColor}`}>
                              {server.protocol.toUpperCase()}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] ${server.isEnabled ? "bg-emerald-500/12 text-emerald-400" : "bg-zinc-800 text-zinc-500"}`}>
                              {server.isEnabled ? "Live" : "Off"}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-zinc-500">
                            {server.country ? `${server.country} · ` : ""}{server.host}:{server.port}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 md:flex-nowrap">
                        <button
                          type="button"
                          onClick={() => void moveServer(absoluteIndex, 'up')}
                          disabled={absoluteIndex === 0 || busy}
                          className="rounded-lg border border-white/8 px-2.5 py-1.5 text-xs text-zinc-500 transition hover:bg-white/6 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => void moveServer(absoluteIndex, 'down')}
                          disabled={absoluteIndex === servers.length - 1 || busy}
                          className="rounded-lg border border-white/8 px-2.5 py-1.5 text-xs text-zinc-500 transition hover:bg-white/6 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => void editServer(server.id)}
                          disabled={pendingServerId === server.id}
                          className="rounded-lg border border-white/8 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/6 hover:text-zinc-100"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggle(server.id, !server.isEnabled)}
                          disabled={pendingServerId === server.id}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                            server.isEnabled
                              ? "border-emerald-700/40 text-emerald-400 hover:bg-emerald-500/10"
                              : "border-white/8 text-zinc-400 hover:bg-white/6 hover:text-zinc-100"
                          }`}
                        >
                          {pendingServerId === server.id ? "..." : server.isEnabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(server.id)}
                          disabled={pendingServerId === server.id}
                          className="rounded-lg border border-rose-700/30 px-3 py-1.5 text-xs text-rose-400/80 transition hover:bg-rose-500/10 hover:text-rose-300"
                        >
                          {pendingServerId === server.id ? "..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  </div>
                )})}
                {servers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/8 px-4 py-10 text-center text-sm text-zinc-600">
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

          <aside className="space-y-4">
            <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
              <p className="text-xs font-medium text-zinc-400">Config preview</p>
              {tab !== "bulk" ? (
                <div className="mt-3">
                  <TextArea
                    label=""
                    value={deferredEffectiveRawConfig}
                    onChange={() => undefined}
                    rows={18}
                    readOnly
                  />
                </div>
              ) : (
                <p className="mt-2 text-xs text-zinc-600">Bulk mode — no preview.</p>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
