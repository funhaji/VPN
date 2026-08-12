type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = (value: string): unknown | null => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const pickString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export const protocolSupportsCredentials = (protocol: string): boolean => {
  const lowered = protocol.trim().toLowerCase();
  if (lowered === "http") return true;
  if (lowered.startsWith("openvpn:")) return true;
  if (lowered.startsWith("ssh:")) return true;
  return false;
};

export const unwrapOpenVpnProfileContent = (rawConfig: string): string => {
  const trimmed = rawConfig.trim();
  const parsed = parseJson(trimmed);
  if (!isObject(parsed)) return trimmed;
  if (pickString(parsed.type)?.toLowerCase() !== "openvpn-profile") return trimmed;

  const profile = pickString(parsed.profile);
  if (!profile) return trimmed;

  // Repair double-wrapped profiles saved after editing in admin.
  return unwrapOpenVpnProfileContent(profile);
};

export type StoredCredentials = {
  username: string;
  password: string;
};

export const readStoredCredentials = (
  rawConfig: string,
  protocol: string,
): StoredCredentials | null => {
  const lowered = protocol.trim().toLowerCase();
  const parsed = parseJson(rawConfig.trim());
  if (!isObject(parsed)) return null;

  if (lowered.startsWith("openvpn:")) {
    const credentials = isObject(parsed.credentials) ? parsed.credentials : {};
    return {
      username: pickString(credentials.username) ?? "",
      password: pickString(credentials.password) ?? "",
    };
  }

  if (lowered === "http") {
    return {
      username: pickString(parsed.username) ?? "",
      password: pickString(parsed.password) ?? "",
    };
  }

  if (lowered.startsWith("ssh:")) {
    if (pickString(parsed.type)?.toLowerCase() === "dnstt-ssh" && isObject(parsed.ssh)) {
      return {
        username: pickString(parsed.ssh.user) ?? "",
        password: pickString(parsed.ssh.password) ?? "",
      };
    }
    if (pickString(parsed.type)?.toLowerCase() === "ssh") {
      return {
        username: pickString(parsed.user) ?? "",
        password: pickString(parsed.password) ?? "",
      };
    }
  }

  return null;
};

export const applyStoredCredentials = (
  rawConfig: string,
  protocol: string,
  update: { username?: string; password?: string },
): string => {
  const lowered = protocol.trim().toLowerCase();
  const parsed = parseJson(rawConfig.trim());
  if (!isObject(parsed)) {
    throw new Error("Credential update requires JSON-backed profile storage");
  }

  const nextUsername = update.username?.trim();
  const nextPassword = update.password?.trim();

  if (lowered.startsWith("openvpn:")) {
    const credentials = isObject(parsed.credentials) ? { ...parsed.credentials } : {};
    if (nextUsername !== undefined) credentials.username = nextUsername;
    if (nextPassword !== undefined) credentials.password = nextPassword;
    parsed.credentials = credentials;
    if (typeof parsed.profile === "string") {
      parsed.profile = unwrapOpenVpnProfileContent(parsed.profile);
    }
    return JSON.stringify(parsed, null, 2);
  }

  if (lowered === "http") {
    if (nextUsername !== undefined) {
      if (nextUsername) parsed.username = nextUsername;
      else delete parsed.username;
    }
    if (nextPassword !== undefined) {
      if (nextPassword) parsed.password = nextPassword;
      else delete parsed.password;
    }
    return JSON.stringify(parsed, null, 2);
  }

  if (lowered.startsWith("ssh:")) {
    if (pickString(parsed.type)?.toLowerCase() === "dnstt-ssh" && isObject(parsed.ssh)) {
      const ssh = { ...parsed.ssh };
      if (nextUsername !== undefined) ssh.user = nextUsername;
      if (nextPassword !== undefined) {
        if (nextPassword) ssh.password = nextPassword;
        else delete ssh.password;
      }
      parsed.ssh = ssh;
      return JSON.stringify(parsed, null, 2);
    }
    if (pickString(parsed.type)?.toLowerCase() === "ssh") {
      if (nextUsername !== undefined) parsed.user = nextUsername;
      if (nextPassword !== undefined) {
        if (nextPassword) parsed.password = nextPassword;
        else delete parsed.password;
      }
      return JSON.stringify(parsed, null, 2);
    }
  }

  throw new Error(`Protocol ${protocol} does not support credential updates`);
};
