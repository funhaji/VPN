"use client";

import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ServerRecord } from "@/types/server";
import { detectProfileMetadata, splitImportedProfiles, parseWireGuardConf, type ParsedWireGuardProfile } from "@/lib/profile-import";
import { protocolSupportsCredentials, unwrapOpenVpnProfileContent } from "@/lib/credentials";
import { RoutingRulesPanel } from "@/components/routing-rules-panel";

type TabId = "v2ray" | "ssh" | "openvpn" | "wireguard" | "custom" | "bulk" | "routing" | "http" | "l2tp";
type SshMode = "direct" | "dnstt";
type SshResolverMode = "udp" | "dot" | "doh";
type OpenVpnMode = "tcp" | "udp";
type OpenVpnInputMode = "file" | "paste";
type WireGuardInputMode = "form" | "file" | "paste";

type WgConfigFile = {
  id: string;
  name: string;
  content: string;
  selected: boolean;
  parsed: ParsedWireGuardProfile | null;
};

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
  wgDns: string;
  wgConf: string;
  openVpnUsername: string;
  openVpnPassword: string;
  httpUsername: string;
  httpPassword: string;
  l2tpUsername: string;
  l2tpPassword: string;
  l2tpPsk: string;
  l2tpAuths: L2tpAuthItem[];
};

type L2tpAuthItem = {
  id: string;
  username: string;
  password: string;
  psk: string;
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
  wgDns: "1.1.1.1, 8.8.8.8",
  wgConf: "",
  openVpnUsername: "",
  openVpnPassword: "",
  httpUsername: "",
  httpPassword: "",
  l2tpUsername: "",
  l2tpPassword: "",
  l2tpPsk: "",
  l2tpAuths: [],
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

const generateWireGuardConfFromForm = (form: FormState): string => {
  const lines: string[] = ["[Interface]"];
  if (form.wgPrivateKey.trim()) lines.push(`PrivateKey = ${form.wgPrivateKey.trim()}`);
  if (form.wgLocalAddress.trim()) lines.push(`Address = ${form.wgLocalAddress.trim()}`);
  if (form.wgDns.trim()) lines.push(`DNS = ${form.wgDns.trim()}`);
  if (form.wgMtu.trim()) lines.push(`MTU = ${form.wgMtu.trim()}`);

  lines.push("", "[Peer]");
  if (form.wgPeerPublicKey.trim()) lines.push(`PublicKey = ${form.wgPeerPublicKey.trim()}`);
  if (form.wgPresharedKey.trim()) lines.push(`PresharedKey = ${form.wgPresharedKey.trim()}`);
  const host = form.host.trim();
  const port = parseNumber(form.port) ?? 51820;
  if (host) lines.push(`Endpoint = ${host}:${port}`);
  if (form.wgAllowedIps.trim()) lines.push(`AllowedIPs = ${form.wgAllowedIps.trim()}`);
  if (form.wgReserved.trim()) lines.push(`Reserved = ${form.wgReserved.trim()}`);

  return lines.join("\n");
};

const buildWireGuardProfile = (form: FormState): string => {
  const generatedConf = form.wgConf.trim() || generateWireGuardConfFromForm(form);
  return JSON.stringify(
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
      ...(splitList(form.wgDns).length > 0 ? { dns: splitList(form.wgDns) } : {}),
      ...(splitList(form.wgReserved).length > 0
        ? { reserved: splitList(form.wgReserved).map((item) => Number(item)).filter(Number.isFinite) }
        : {}),
      ...(parseNumber(form.wgMtu) ? { mtu: parseNumber(form.wgMtu) } : {}),
      ...(generatedConf ? { conf: generatedConf } : {}),
    },
    null,
    2,
  );
};

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

const buildL2tpProfile = (form: FormState): string => {
  const extraAuths = (form.l2tpAuths || [])
    .map((item) => ({
      username: item.username.trim(),
      password: item.password.trim(),
      ...(item.psk.trim() ? { psk: item.psk.trim() } : {}),
    }))
    .filter((item) => Boolean(item.username && item.password));

  return JSON.stringify(
    {
      server: form.host.trim(),
      username: form.l2tpUsername.trim(),
      password: form.l2tpPassword.trim(),
      psk: form.l2tpPsk.trim(),
      ...(extraAuths.length > 0 ? { auths: extraAuths } : {}),
    },
    null,
    2,
  );
};

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
    const cleanName = stripLeadingCountryFlag(props.name).trim();
    props.set("name", cleanName ? `${country.flag} ${cleanName}` : `${country.flag} ${country.name}`);
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
  const [wgInputMode, setWgInputMode] = useState<WireGuardInputMode>("form");
  const [wgFiles, setWgFiles] = useState<WgConfigFile[]>([]);
  const [wgDragging, setWgDragging] = useState(false);
  const wgFileInputRef = useRef<HTMLInputElement>(null);
  const [wgPastedText, setWgPastedText] = useState("");
  const [wgPreviewMode, setWgPreviewMode] = useState<"json" | "conf">("json");
  const [customProto, setCustomProto] = useState("custom:tcp");
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hasPendingReorder, setHasPendingReorder] = useState(false);
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
      setServersPage((p) => Math.min(p, Math.max(0, Math.ceil(data.servers.length / PAGE_SIZE) - 1)));
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

  const handleWgFiles = useCallback(async (files: File[]) => {
    const selectedCountry = COUNTRIES.find((c) => c.code === form.country);
    const countryFlag = selectedCountry ? selectedCountry.flag : "";
    const loaded = await Promise.all(
      files.map(async (file, idx): Promise<WgConfigFile> => {
        const content = await file.text();
        let baseName = file.name.replace(/\.conf$/i, "");
        if (files.length === 1 && form.name.trim()) {
          baseName = stripLeadingCountryFlag(form.name).trim();
        } else if (form.name.trim() && files.length > 1) {
          baseName = `${stripLeadingCountryFlag(form.name).trim()} ${idx + 1}`;
        }
        const fileNameWithFlag = countryFlag
          ? `${countryFlag} ${stripLeadingCountryFlag(baseName).trim()}`
          : baseName;
        const parsed = parseWireGuardConf(content);
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: fileNameWithFlag || file.name,
          content,
          selected: true,
          parsed,
        };
      }),
    );
    setWgFiles((prev) => {
      const existingContents = new Set(prev.map((f) => f.content));
      const fresh = loaded.filter((f) => !existingContents.has(f.content));
      return [...prev, ...fresh];
    });
  }, [form.country, form.name]);

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
        wgLocalAddress: prev.wgLocalAddress,
        wgPrivateKey: prev.wgPrivateKey,
        wgPeerPublicKey: prev.wgPeerPublicKey,
        wgPresharedKey: prev.wgPresharedKey,
        wgAllowedIps: prev.wgAllowedIps,
        wgReserved: prev.wgReserved,
        wgMtu: prev.wgMtu,
        wgDns: prev.wgDns,
        wgConf: prev.wgConf,
      }));
    } else {
      setForm(BLANK);
      setVariant("vless");
      setSshMode("direct");
      setSshResolverMode("udp");
      setOpenVpnMode("udp");
      setOvpnFiles([]);
      setWgFiles([]);
      setWgPastedText("");
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

  const [protocolFilter, setProtocolFilter] = useState<string>("all");
  const [showBulkPasteAuth, setShowBulkPasteAuth] = useState(false);
  const [bulkPasteText, setBulkPasteText] = useState("");

  const addL2tpAuthItem = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      l2tpAuths: [
        ...prev.l2tpAuths,
        {
          id: `auth-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          username: "",
          password: "",
          psk: "",
        },
      ],
    }));
  }, []);

  const updateL2tpAuthItem = useCallback(
    (id: string, field: "username" | "password" | "psk", value: string) => {
      setForm((prev) => ({
        ...prev,
        l2tpAuths: prev.l2tpAuths.map((item) =>
          item.id === id ? { ...item, [field]: value } : item
        ),
      }));
    },
    []
  );

  const removeL2tpAuthItem = useCallback((id: string) => {
    setForm((prev) => ({
      ...prev,
      l2tpAuths: prev.l2tpAuths.filter((item) => item.id !== id),
    }));
  }, []);

  const handleBulkPasteAuth = useCallback(() => {
    if (!bulkPasteText.trim()) return;
    const lines = bulkPasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const newItems: L2tpAuthItem[] = [];

    for (const line of lines) {
      let parts: string[] = [];
      if (line.includes(":")) parts = line.split(":");
      else if (line.includes(",")) parts = line.split(",");
      else parts = line.split(/\s+/);

      const u = parts[0]?.trim();
      const p = parts[1]?.trim();
      const k = parts[2]?.trim() || "";

      if (u && p) {
        newItems.push({
          id: `auth-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          username: u,
          password: p,
          psk: k,
        });
      }
    }

    if (newItems.length > 0) {
      setForm((prev) => ({
        ...prev,
        l2tpAuths: [...prev.l2tpAuths, ...newItems],
      }));
      setBulkPasteText("");
      setShowBulkPasteAuth(false);
    }
  }, [bulkPasteText]);

  const protocolFilterTabs = useMemo(() => {
    let l2tp = 0;
    let v2ray = 0;
    let openvpn = 0;
    let wireguard = 0;
    let ssh = 0;
    let http = 0;

    for (const s of servers) {
      const p = s.protocol.toLowerCase();
      if (p.startsWith("l2tp")) l2tp++;
      else if (
        p.startsWith("v2ray") ||
        p.startsWith("vless") ||
        p.startsWith("vmess") ||
        p.startsWith("trojan") ||
        p.startsWith("ss:") ||
        p.startsWith("hysteria") ||
        p.startsWith("shadowsocks")
      ) {
        v2ray++;
      } else if (p.startsWith("openvpn")) openvpn++;
      else if (p.startsWith("wireguard") || p === "wg") wireguard++;
      else if (p.startsWith("ssh")) ssh++;
      else if (p === "http") http++;
    }

    return [
      { id: "all", label: "All", count: servers.length },
      { id: "l2tp", label: "L2TP", count: l2tp },
      { id: "v2ray", label: "V2Ray", count: v2ray },
      { id: "openvpn", label: "OpenVPN", count: openvpn },
      { id: "wireguard", label: "WireGuard", count: wireguard },
      { id: "ssh", label: "SSH", count: ssh },
      { id: "http", label: "HTTP", count: http },
    ];
  }, [servers]);

  const filteredServers = useMemo(() => {
    if (protocolFilter === "all") return servers;
    return servers.filter((s) => {
      const p = s.protocol.toLowerCase();
      if (protocolFilter === "l2tp") return p.startsWith("l2tp");
      if (protocolFilter === "v2ray") {
        return (
          p.startsWith("v2ray") ||
          p.startsWith("vless") ||
          p.startsWith("vmess") ||
          p.startsWith("trojan") ||
          p.startsWith("ss:") ||
          p.startsWith("hysteria") ||
          p.startsWith("shadowsocks")
        );
      }
      if (protocolFilter === "openvpn") return p.startsWith("openvpn");
      if (protocolFilter === "wireguard") return p.startsWith("wireguard") || p === "wg";
      if (protocolFilter === "ssh") return p.startsWith("ssh");
      if (protocolFilter === "http") return p === "http";
      return true;
    });
  }, [servers, protocolFilter]);

  const PAGE_SIZE = 8;
  const totalFilteredPages = Math.max(1, Math.ceil(filteredServers.length / PAGE_SIZE));
  const displayedServers = useMemo(
    () => filteredServers.slice(serversPage * PAGE_SIZE, (serversPage + 1) * PAGE_SIZE),
    [filteredServers, serversPage],
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

  const previewWgConf = useMemo(() => {
    return form.wgConf.trim() || generateWireGuardConfFromForm(form);
  }, [form]);

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
      if (wgInputMode === "file") {
        return wgFiles.some((f) => f.selected && f.parsed != null);
      }
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
  }, [bulk, effectiveRawConfig, form, openVpnInputMode, ovpnFiles, sshMode, tab, wgFiles, wgInputMode]);

  const submit = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      // ── WireGuard file-upload bulk submit ────────────────────────────────
      if (tab === "wireguard" && wgInputMode === "file") {
        const selectedFiles = wgFiles.filter((file) => file.selected);
        if (selectedFiles.length === 0) {
          throw new Error("Select at least one WireGuard .conf file");
        }
        const selectedCountry = COUNTRIES.find((c) => c.code === form.country);
        const countryFlag = selectedCountry ? selectedCountry.flag : "";
        const countryCode = selectedCountry ? selectedCountry.code : (form.country.trim() || "XX");

        const payloads = selectedFiles.map((file) => {
          const parsed = file.parsed ?? parseWireGuardConf(file.content);
          if (!parsed) {
            throw new Error(`Could not parse WireGuard configuration in ${file.name}`);
          }
          const rawConfig = JSON.stringify(parsed, null, 2);
          let chosenName = (selectedFiles.length === 1 && form.name.trim())
            ? form.name.trim()
            : (file.name.trim() || `WireGuard ${parsed.endpoint.host}`);

          if (countryFlag && !chosenName.startsWith(countryFlag)) {
            chosenName = `${countryFlag} ${stripLeadingCountryFlag(chosenName).trim()}`;
          }

          const safeName = chosenName.trim();
          return {
            name: safeName.length >= 2 ? safeName : `${safeName} Profile`,
            protocol: "wireguard:profile",
            country: countryCode,
            rawConfig,
            isEnabled: true,
            options: { mux: false, fragment: false, sniffing: false, allowInsecure: false, extra: {} },
            host: parsed.endpoint.host,
            port: parsed.endpoint.port,
          };
        });
        await api("/api/admin/servers", {
          method: "POST",
          body: JSON.stringify({ servers: payloads }),
        });
        setMsg({ ok: true, text: `Imported ${payloads.length} WireGuard profile${payloads.length !== 1 ? "s" : ""}` });
        setWgFiles([]);
        await load();
        return;
      }
      // ── End WireGuard file-upload ────────────────────────────────────────

      // ── OpenVPN file-upload bulk submit ──────────────────────────────────
      if (tab === "openvpn" && openVpnInputMode === "file") {
        const selectedFiles = ovpnFiles.filter((file) => file.selected);
        if (selectedFiles.length === 0) {
          throw new Error("Select at least one OpenVPN file");
        }
        const selectedCountry = COUNTRIES.find((c) => c.code === form.country);
        const countryFlag = selectedCountry ? selectedCountry.flag : "";
        const countryCode = selectedCountry ? selectedCountry.code : (form.country.trim() || "XX");

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
          let chosenName = (selectedFiles.length === 1 && form.name.trim())
            ? form.name.trim()
            : (file.name.trim() || `OpenVPN ${detected?.host ?? "Config"}`);

          if (countryFlag && !chosenName.startsWith(countryFlag)) {
            chosenName = `${countryFlag} ${stripLeadingCountryFlag(chosenName).trim()}`;
          }

          const safeName = chosenName.trim();
          return {
            name: safeName.length >= 2 ? safeName : `${safeName} Config`,
            protocol: `openvpn:${transport}`,
            country: countryCode,
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
      const selectedCountry = COUNTRIES.find((c) => c.code === form.country);
      const countryFlag = selectedCountry ? selectedCountry.flag : "";
      const countryCode = selectedCountry ? selectedCountry.code : (form.country.trim() || detected.country);

      let finalName = form.name.trim() || detected.name;
      if (countryFlag && !finalName.startsWith(countryFlag)) {
        finalName = `${countryFlag} ${stripLeadingCountryFlag(finalName).trim()}`;
      }

      const payload: Record<string, unknown> = {
        name: finalName,
        protocol: detected.protocol,
        country: countryCode,
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

  const moveServer = useCallback(async (serverId: string, direction: 'up' | 'down') => {
    const indexInList = servers.findIndex((s) => s.id === serverId);
    if (indexInList === -1) return;
    if (direction === 'up' && indexInList === 0) return;
    if (direction === 'down' && indexInList === servers.length - 1) return;

    const newServers = [...servers];
    const targetIndex = direction === 'up' ? indexInList - 1 : indexInList + 1;
    const temp = newServers[indexInList];
    newServers[indexInList] = newServers[targetIndex];
    newServers[targetIndex] = temp;
    setServers(newServers);
    setHasPendingReorder(true);
  }, [servers]);

  const saveOrder = useCallback(async () => {
    setBusy(true);
    try {
      const orders = servers.map((s, idx) => ({ id: s.id, sort_order: idx }));
      await api("/api/admin/servers/reorder", {
        method: "POST",
        body: JSON.stringify(orders),
      });
      setHasPendingReorder(false);
      await load();
    } catch {
      setMsg({ ok: false, text: "Save Order failed" });
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
      } else if (proto.startsWith("wireguard") || proto === "wg") {
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
      let l2tpAuths: L2tpAuthItem[] = [];
      let wgLocalAddress = "10.0.0.2/32";
      let wgPrivateKey = "";
      let wgPeerPublicKey = "";
      let wgPresharedKey = "";
      let wgAllowedIps = "0.0.0.0/0";
      let wgReserved = "";
      let wgMtu = "1408";
      let wgDns = "1.1.1.1, 8.8.8.8";
      let wgConf = "";
      let wgHost = s.host;
      let wgPort = String(s.port);
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
          if (Array.isArray(parsed.auths)) {
            l2tpAuths = parsed.auths.map((item: any, idx: number) => ({
              id: `auth-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
              username: String(item.username || ""),
              password: String(item.password || ""),
              psk: String(item.psk || ""),
            }));
          }
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

      if (newTab === "wireguard") {
        setWgInputMode("form");
        try {
          const parsed = JSON.parse(data.rawConfig);
          if (parsed && typeof parsed === "object") {
            if (parsed.endpoint && typeof parsed.endpoint === "object") {
              if (parsed.endpoint.host) wgHost = String(parsed.endpoint.host);
              if (parsed.endpoint.port) wgPort = String(parsed.endpoint.port);
            } else if (parsed.server) {
              wgHost = String(parsed.server);
              if (parsed.server_port) wgPort = String(parsed.server_port);
            }
            if (Array.isArray(parsed.local_address)) {
              wgLocalAddress = parsed.local_address.join(", ");
            } else if (typeof parsed.local_address === "string") {
              wgLocalAddress = parsed.local_address;
            }
            if (parsed.private_key) wgPrivateKey = String(parsed.private_key);
            if (parsed.peer_public_key) wgPeerPublicKey = String(parsed.peer_public_key);
            if (parsed.pre_shared_key) wgPresharedKey = String(parsed.pre_shared_key);
            if (Array.isArray(parsed.allowed_ips)) {
              wgAllowedIps = parsed.allowed_ips.join(", ");
            } else if (typeof parsed.allowed_ips === "string") {
              wgAllowedIps = parsed.allowed_ips;
            }
            if (Array.isArray(parsed.dns)) {
              wgDns = parsed.dns.join(", ");
            } else if (typeof parsed.dns === "string") {
              wgDns = parsed.dns;
            }
            if (Array.isArray(parsed.reserved)) {
              wgReserved = parsed.reserved.join(", ");
            }
            if (parsed.mtu) wgMtu = String(parsed.mtu);
            if (parsed.conf) wgConf = String(parsed.conf);
          }
        } catch {
          const parsedConf = parseWireGuardConf(data.rawConfig);
          if (parsedConf) {
            wgHost = parsedConf.endpoint.host;
            wgPort = String(parsedConf.endpoint.port);
            wgLocalAddress = parsedConf.local_address.join(", ");
            wgPrivateKey = parsedConf.private_key;
            wgPeerPublicKey = parsedConf.peer_public_key;
            if (parsedConf.pre_shared_key) wgPresharedKey = parsedConf.pre_shared_key;
            if (parsedConf.allowed_ips) wgAllowedIps = parsedConf.allowed_ips.join(", ");
            if (parsedConf.dns) wgDns = parsedConf.dns.join(", ");
            if (parsedConf.reserved) wgReserved = parsedConf.reserved.join(", ");
            if (parsedConf.mtu) wgMtu = String(parsedConf.mtu);
            wgConf = parsedConf.conf || data.rawConfig;
          }
        }
        if (!wgConf) {
          wgConf = generateWireGuardConfFromForm({
            ...BLANK,
            host: wgHost,
            port: wgPort,
            wgLocalAddress,
            wgPrivateKey,
            wgPeerPublicKey,
            wgPresharedKey,
            wgAllowedIps,
            wgReserved,
            wgMtu,
            wgDns,
            wgConf: "",
          });
        }
      }
      
      setForm({
        ...BLANK,
        name: s.name,
        country: s.country,
        host: newTab === "wireguard" ? wgHost : s.host,
        port: newTab === "wireguard" ? wgPort : String(s.port),
        rawConfig,
        httpUsername,
        httpPassword,
        l2tpUsername,
        l2tpPassword,
        l2tpPsk,
        l2tpAuths,
        openVpnUsername,
        openVpnPassword,
        wgLocalAddress,
        wgPrivateKey,
        wgPeerPublicKey,
        wgPresharedKey,
        wgAllowedIps,
        wgReserved,
        wgMtu,
        wgDns,
        wgConf,
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
                  <div className="mt-6 space-y-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <ToggleChip label="Manual form" checked={wgInputMode === "form"} onChange={() => setWgInputMode("form")} />
                      <ToggleChip label="Upload .conf files" checked={wgInputMode === "file"} onChange={() => setWgInputMode("file")} />
                      <ToggleChip label="Paste .conf text" checked={wgInputMode === "paste"} onChange={() => setWgInputMode("paste")} />
                    </div>

                    {wgInputMode === "file" ? (
                      <div className="space-y-4">
                        <div
                          onDragOver={(e) => { e.preventDefault(); setWgDragging(true); }}
                          onDragLeave={() => setWgDragging(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setWgDragging(false);
                            const files = Array.from(e.dataTransfer.files).filter((f) => f.name.toLowerCase().endsWith(".conf"));
                            void handleWgFiles(files);
                          }}
                          onClick={() => wgFileInputRef.current?.click()}
                          className={`cursor-pointer select-none rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
                            wgDragging
                              ? "border-cyan-400/80 bg-cyan-400/10"
                              : "border-zinc-700 hover:border-zinc-600 hover:bg-zinc-900/40"
                          }`}
                        >
                          <input
                            ref={wgFileInputRef}
                            type="file"
                            accept=".conf"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                              const files = Array.from(e.target.files ?? []);
                              void handleWgFiles(files);
                              e.target.value = "";
                            }}
                          />
                          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-400 text-lg">
                            ↑
                          </div>
                          <p className="text-sm font-medium text-zinc-300">Drop .conf files here or click to browse</p>
                          <p className="mt-1 text-xs text-zinc-600">Multiple files supported: filename becomes the server name</p>
                        </div>

                        {wgFiles.length > 0 && (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3 px-1">
                              <label className="flex cursor-pointer items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="accent-cyan-400"
                                  checked={wgFiles.every((f) => f.selected)}
                                  onChange={(e) =>
                                    setWgFiles((prev) => prev.map((f) => ({ ...f, selected: e.target.checked })))
                                  }
                                />
                                <span className="text-xs text-zinc-400">
                                  {wgFiles.filter((f) => f.selected).length} of {wgFiles.length} selected
                                </span>
                              </label>
                              <button
                                type="button"
                                onClick={() => setWgFiles([])}
                                className="text-xs text-zinc-600 transition hover:text-rose-400"
                              >
                                Clear all
                              </button>
                            </div>

                            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                              {wgFiles.map((file) => (
                                <div
                                  key={file.id}
                                  className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-2"
                                >
                                  <div className="flex items-center gap-2.5">
                                    <input
                                      type="checkbox"
                                      className="accent-cyan-400"
                                      checked={file.selected}
                                      onChange={(e) =>
                                        setWgFiles((prev) =>
                                          prev.map((f) => (f.id === file.id ? { ...f, selected: e.target.checked } : f)),
                                        )
                                      }
                                    />
                                    <input
                                      type="text"
                                      value={file.name}
                                      onChange={(e) =>
                                        setWgFiles((prev) =>
                                          prev.map((f) => (f.id === file.id ? { ...f, name: e.target.value } : f)),
                                        )
                                      }
                                      className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500"
                                    />
                                    <span className="font-mono text-[10px] text-zinc-500">
                                      {file.parsed ? `${file.parsed.endpoint.host}:${file.parsed.endpoint.port}` : "parse error"}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : wgInputMode === "paste" ? (
                      <div className="space-y-4">
                        <TextArea
                          label="Paste WireGuard .conf content"
                          value={wgPastedText}
                          onChange={(val) => {
                            setWgPastedText(val);
                            const parsed = parseWireGuardConf(val);
                            if (parsed) {
                              setForm((prev) => ({
                                ...prev,
                                host: parsed.endpoint.host,
                                port: String(parsed.endpoint.port),
                                wgLocalAddress: parsed.local_address.join(", "),
                                wgPrivateKey: parsed.private_key,
                                wgPeerPublicKey: parsed.peer_public_key,
                                wgPresharedKey: parsed.pre_shared_key ?? "",
                                wgAllowedIps: parsed.allowed_ips ? parsed.allowed_ips.join(", ") : "0.0.0.0/0",
                                wgMtu: parsed.mtu ? String(parsed.mtu) : "1408",
                                wgReserved: parsed.reserved ? parsed.reserved.join(", ") : "",
                                wgDns: parsed.dns ? parsed.dns.join(", ") : "1.1.1.1, 8.8.8.8",
                                wgConf: parsed.conf || val,
                              }));
                            }
                          }}
                          rows={8}
                          placeholder={"[Interface]\nPrivateKey = ...\nAddress = 10.0.0.2/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = ...\nEndpoint = 192.0.2.1:51820\nAllowedIPs = 0.0.0.0/0"}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const parsed = parseWireGuardConf(wgPastedText);
                            if (parsed) {
                              setForm((prev) => ({
                                ...prev,
                                host: parsed.endpoint.host,
                                port: String(parsed.endpoint.port),
                                wgLocalAddress: parsed.local_address.join(", "),
                                wgPrivateKey: parsed.private_key,
                                wgPeerPublicKey: parsed.peer_public_key,
                                wgPresharedKey: parsed.pre_shared_key ?? "",
                                wgAllowedIps: parsed.allowed_ips ? parsed.allowed_ips.join(", ") : "0.0.0.0/0",
                                wgMtu: parsed.mtu ? String(parsed.mtu) : "1408",
                                wgReserved: parsed.reserved ? parsed.reserved.join(", ") : "",
                                wgDns: parsed.dns ? parsed.dns.join(", ") : "1.1.1.1, 8.8.8.8",
                                wgConf: parsed.conf || wgPastedText,
                              }));
                              setWgInputMode("form");
                              setMsg({ ok: true, text: "Configuration parsed into form fields." });
                            } else {
                              setMsg({ ok: false, text: "Could not parse WireGuard configuration. Make sure [Interface] and [Peer] are present." });
                            }
                          }}
                          className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 transition"
                        >
                          Populate form from pasted config
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="Endpoint host" value={form.host} onChange={(value) => set("host", value)} placeholder="162.159.193.10" />
                          <Field label="Endpoint port" value={form.port} onChange={(value) => set("port", value)} placeholder="51820" />
                          <Field label="Local address" value={form.wgLocalAddress} onChange={(value) => set("wgLocalAddress", value)} placeholder="10.0.0.2/32" mono />
                          <Field label="MTU" value={form.wgMtu} onChange={(value) => set("wgMtu", value)} placeholder="1408" />
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="DNS servers" value={form.wgDns} onChange={(value) => set("wgDns", value)} placeholder="1.1.1.1, 8.8.8.8" mono />
                          <Field label="Pre-shared key" value={form.wgPresharedKey} onChange={(value) => set("wgPresharedKey", value)} placeholder="Optional" mono />
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <TextArea label="Private key" value={form.wgPrivateKey} onChange={(value) => set("wgPrivateKey", value)} rows={3} placeholder="Base64 private key" />
                          <TextArea label="Peer public key" value={form.wgPeerPublicKey} onChange={(value) => set("wgPeerPublicKey", value)} rows={3} placeholder="Base64 peer public key" />
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <TextArea label="Allowed IPs" value={form.wgAllowedIps} onChange={(value) => set("wgAllowedIps", value)} rows={3} placeholder="0.0.0.0/0, ::/0" />
                          <Field label="Reserved bytes" value={form.wgReserved} onChange={(value) => set("wgReserved", value)} placeholder="0,0,0" mono />
                        </div>
                        <div className="rounded-2xl border border-white/6 bg-white/2 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs font-medium text-zinc-300">Raw .conf text</p>
                              <p className="text-[11px] text-zinc-500">Standard WireGuard client configuration</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const generated = generateWireGuardConfFromForm(form);
                                  set("wgConf", generated);
                                  setMsg({ ok: true, text: "Synchronized .conf from form fields." });
                                }}
                                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10 transition"
                              >
                                Sync from fields
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const textToParse = form.wgConf.trim() || generateWireGuardConfFromForm(form);
                                  const parsed = parseWireGuardConf(textToParse);
                                  if (parsed) {
                                    setForm((prev) => ({
                                      ...prev,
                                      host: parsed.endpoint.host || prev.host,
                                      port: parsed.endpoint.port ? String(parsed.endpoint.port) : prev.port,
                                      wgLocalAddress: parsed.local_address.length > 0 ? parsed.local_address.join(", ") : prev.wgLocalAddress,
                                      wgPrivateKey: parsed.private_key || prev.wgPrivateKey,
                                      wgPeerPublicKey: parsed.peer_public_key || prev.wgPeerPublicKey,
                                      wgPresharedKey: parsed.pre_shared_key ?? prev.wgPresharedKey,
                                      wgAllowedIps: parsed.allowed_ips ? parsed.allowed_ips.join(", ") : prev.wgAllowedIps,
                                      wgMtu: parsed.mtu ? String(parsed.mtu) : prev.wgMtu,
                                      wgReserved: parsed.reserved ? parsed.reserved.join(", ") : prev.wgReserved,
                                      wgDns: parsed.dns ? parsed.dns.join(", ") : prev.wgDns,
                                      wgConf: parsed.conf || textToParse,
                                    }));
                                    setMsg({ ok: true, text: "Form fields updated from .conf text." });
                                  } else {
                                    setMsg({ ok: false, text: "Could not parse .conf text." });
                                  }
                                }}
                                className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-300 hover:bg-cyan-500/20 transition"
                              >
                                Parse into fields
                              </button>
                            </div>
                          </div>
                          <TextArea
                            label=""
                            value={form.wgConf || generateWireGuardConfFromForm(form)}
                            onChange={(val) => set("wgConf", val)}
                            rows={6}
                            placeholder={"[Interface]\n..."}
                          />
                        </div>
                      </div>
                    )}
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
                    <div className="rounded-2xl border border-white/6 bg-white/2 p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        Primary / Default Credentials
                      </p>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field
                          label="Server host / IP"
                          value={form.host}
                          onChange={(value) => set("host", value)}
                          placeholder="vpn.example.com"
                        />
                        <Field
                          label="Default IPsec PSK"
                          value={form.l2tpPsk}
                          onChange={(value) => set("l2tpPsk", value)}
                          placeholder="IPsec PSK"
                        />
                        <Field
                          label="Default Username"
                          value={form.l2tpUsername}
                          onChange={(value) => set("l2tpUsername", value)}
                          placeholder="L2TP Username"
                        />
                        <Field
                          label="Default Password"
                          value={form.l2tpPassword}
                          onChange={(value) => set("l2tpPassword", value)}
                          placeholder="L2TP Password"
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/6 bg-white/2 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-zinc-100">Multi-Auth Accounts Pool</p>
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                              {form.l2tpAuths.length} extra {form.l2tpAuths.length === 1 ? "account" : "accounts"}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-zinc-400">
                            Whenever a client fetches or refreshes servers, the backend randomly assigns one account from this pool.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setShowBulkPasteAuth((prev) => !prev)}
                            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-white/10"
                          >
                            {showBulkPasteAuth ? "Hide Bulk" : "Bulk Paste"}
                          </button>
                          <button
                            type="button"
                            onClick={addL2tpAuthItem}
                            className="rounded-lg bg-emerald-600/80 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500"
                          >
                            + Add Account
                          </button>
                        </div>
                      </div>

                      {showBulkPasteAuth ? (
                        <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3">
                          <p className="text-xs font-medium text-emerald-300">
                            Paste accounts (one per line): <span className="font-mono text-zinc-400">username:password</span> or <span className="font-mono text-zinc-400">username:password:psk</span>
                          </p>
                          <textarea
                            rows={4}
                            value={bulkPasteText}
                            onChange={(e) => setBulkPasteText(e.target.value)}
                            placeholder={"user1:pass1\nuser2:pass2\nuser3:pass3:customPsk"}
                            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 p-2 font-mono text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                          />
                          <div className="mt-2 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setBulkPasteText("");
                                setShowBulkPasteAuth(false);
                              }}
                              className="rounded-lg px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleBulkPasteAuth}
                              disabled={!bulkPasteText.trim()}
                              className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
                            >
                              Import Accounts
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {form.l2tpAuths.length > 0 ? (
                        <div className="mt-4 space-y-2.5">
                          {form.l2tpAuths.map((authItem, idx) => (
                            <div
                              key={authItem.id}
                              className="flex flex-col gap-2 rounded-xl border border-white/5 bg-zinc-900/60 p-3 sm:flex-row sm:items-center"
                            >
                              <span className="w-7 text-xs font-bold text-zinc-500 sm:text-center">#{idx + 1}</span>
                              <div className="flex-1">
                                <input
                                  type="text"
                                  value={authItem.username}
                                  onChange={(e) => updateL2tpAuthItem(authItem.id, "username", e.target.value)}
                                  placeholder="Username"
                                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
                                />
                              </div>
                              <div className="flex-1">
                                <input
                                  type="text"
                                  value={authItem.password}
                                  onChange={(e) => updateL2tpAuthItem(authItem.id, "password", e.target.value)}
                                  placeholder="Password"
                                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
                                />
                              </div>
                              <div className="flex-1">
                                <input
                                  type="text"
                                  value={authItem.psk}
                                  onChange={(e) => updateL2tpAuthItem(authItem.id, "psk", e.target.value)}
                                  placeholder="PSK (defaults to main PSK)"
                                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => removeL2tpAuthItem(authItem.id)}
                                className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-400"
                                title="Remove account"
                                aria-label="Remove account"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="18" y1="6" x2="6" y2="18"></line>
                                  <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-center text-xs text-zinc-600">
                          No extra accounts added yet. Only the default credentials above will be used.
                        </p>
                      )}
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
                  {hasPendingReorder && (
                    <button
                      type="button"
                      onClick={() => void saveOrder()}
                      disabled={busy}
                      className="rounded-xl border border-cyan-500/50 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/20 shadow-[0_0_15px_rgba(34,211,238,0.2)]"
                    >
                      Save Order
                    </button>
                  )}
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

              {/* Protocol Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-white/6 bg-white/2 p-1.5">
                {protocolFilterTabs.map((f) => {
                  const isActive = protocolFilter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setProtocolFilter(f.id);
                        setServersPage(0);
                      }}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                        isActive
                          ? "bg-cyan-400 text-cyan-950 font-semibold shadow-sm"
                          : "text-zinc-400 hover:bg-white/4 hover:text-zinc-200"
                      }`}
                    >
                      <span>{f.label}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          isActive
                            ? "bg-cyan-950/20 text-cyan-900"
                            : "bg-white/6 text-zinc-500"
                        }`}
                      >
                        {f.count}
                      </span>
                    </button>
                  );
                })}
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
                {displayedServers.map((server) => {
                  const supportsCredentials = protocolSupportsCredentials(server.protocol);
                  const serverIndexInAll = servers.findIndex((s) => s.id === server.id);
                  const isFirst = serverIndexInAll <= 0;
                  const isLast = serverIndexInAll === -1 || serverIndexInAll >= servers.length - 1;
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
                            {server.accountCount && server.accountCount > 1 ? (
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-semibold text-emerald-300 uppercase tracking-wide">
                                {server.accountCount} AUTHS
                              </span>
                            ) : null}
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
                          onClick={() => void moveServer(server.id, 'up')}
                          disabled={isFirst || busy}
                          className="rounded-lg border border-white/8 px-2.5 py-1.5 text-xs text-zinc-500 transition hover:bg-white/6 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => void moveServer(server.id, 'down')}
                          disabled={isLast || busy}
                          className="rounded-lg border border-white/8 px-2.5 py-1.5 text-xs text-zinc-500 transition hover:bg-white/6 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Move down"
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
                {filteredServers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/8 px-4 py-10 text-center text-sm text-zinc-600">
                    {servers.length === 0
                      ? "No servers yet — use one of the builders above to create the first profile."
                      : `No servers found matching the "${protocolFilter.toUpperCase()}" filter.`}
                  </div>
                ) : null}
              </div>

              {filteredServers.length > PAGE_SIZE ? (
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
                    Page {serversPage + 1} / {totalFilteredPages}
                  </div>
                  <button
                    type="button"
                    className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => setServersPage((p) => Math.min(totalFilteredPages - 1, p + 1))}
                    disabled={serversPage >= totalFilteredPages - 1}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-zinc-400">Config preview</p>
                {tab === "wireguard" ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setWgPreviewMode("json")}
                      className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition ${
                        wgPreviewMode === "json"
                          ? "bg-white/10 text-cyan-300 ring-1 ring-white/15"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => setWgPreviewMode("conf")}
                      className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition ${
                        wgPreviewMode === "conf"
                          ? "bg-white/10 text-cyan-300 ring-1 ring-white/15"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      .CONF
                    </button>
                  </div>
                ) : null}
              </div>
              {tab !== "bulk" ? (
                <div className="mt-3">
                  <TextArea
                    label=""
                    value={tab === "wireguard" && wgPreviewMode === "conf" ? previewWgConf : deferredEffectiveRawConfig}
                    onChange={() => undefined}
                    rows={18}
                    readOnly
                  />
                </div>
              ) : (
                <p className="mt-2 text-xs text-zinc-600">Bulk mode: no preview.</p>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
