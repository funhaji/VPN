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
  if (lowered.startsWith("ssh") || lowered.includes("ssh")) return true;
  if (lowered.startsWith("l2tp")) return true;
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
  const trimmed = rawConfig.trim();
  const parsed = parseJson(trimmed);

  if (lowered.startsWith("openvpn:")) {
    if (!isObject(parsed)) return null;
    const credentials = isObject(parsed.credentials) ? parsed.credentials : {};
    return {
      username: pickString(credentials.username) ?? "",
      password: pickString(credentials.password) ?? "",
    };
  }

  if (lowered === "http") {
    if (!isObject(parsed)) return null;
    return {
      username: pickString(parsed.username) ?? "",
      password: pickString(parsed.password) ?? "",
    };
  }

  if (lowered.startsWith("ssh") || lowered.includes("ssh")) {
    if (isObject(parsed)) {
      if (pickString(parsed.type)?.toLowerCase() === "dnstt-ssh" && isObject(parsed.ssh)) {
        return {
          username: pickString(parsed.ssh.user) ?? pickString(parsed.ssh.username) ?? "",
          password: pickString(parsed.ssh.password) ?? pickString(parsed.ssh.pass) ?? "",
        };
      }
      let target: any = parsed;
      if (Array.isArray(parsed.outbounds)) {
        const sshOut = parsed.outbounds.find((o: any) => isObject(o) && (pickString(o.type)?.toLowerCase() === "ssh" || pickString(o.protocol)?.toLowerCase() === "ssh"));
        if (sshOut) target = sshOut;
      }
      if (isObject(target.ssh)) {
        return {
          username: pickString(target.ssh.user) ?? pickString(target.ssh.username) ?? pickString(target.ssh.user_name) ?? "",
          password: pickString(target.ssh.password) ?? pickString(target.ssh.pass) ?? "",
        };
      }
      return {
        username: pickString(target.user) ?? pickString(target.username) ?? pickString(target.user_name) ?? pickString(target.sshUser) ?? "",
        password: pickString(target.password) ?? pickString(target.pass) ?? pickString(target.sshPassword) ?? "",
      };
    }
    if (trimmed.toLowerCase().startsWith("ssh://")) {
      try {
        const url = new URL(trimmed);
        return {
          username: decodeURIComponent(url.username || ""),
          password: decodeURIComponent(url.password || ""),
        };
      } catch {
        const m = trimmed.match(/^ssh:\/\/([^:@]+)(?::([^@]+))?@/i);
        if (m) {
          return {
            username: decodeURIComponent(m[1] || ""),
            password: decodeURIComponent(m[2] || ""),
          };
        }
      }
    }
    const userPassMatch = trimmed.match(/^([^:@\s]+):([^@\s]+)@([^:@\s]+):(\d+)$/);
    if (userPassMatch) {
      return {
        username: decodeURIComponent(userPassMatch[1]),
        password: decodeURIComponent(userPassMatch[2]),
      };
    }
    const hostPortUserPassMatch = trimmed.match(/^([^:@\s]+):(\d+):([^:@\s]+):([^@\s]+)$/);
    if (hostPortUserPassMatch) {
      return {
        username: hostPortUserPassMatch[3],
        password: hostPortUserPassMatch[4],
      };
    }
    const lines = trimmed.split(/\r?\n/);
    let lineUser = "";
    let linePass = "";
    for (const line of lines) {
      const idx = line.search(/[:=\t]/);
      if (idx !== -1) {
        const key = line.slice(0, idx).trim().toLowerCase();
        const val = line.slice(idx + 1).trim().replace(/^[:=\t]+/, "").trim();
        if ((key === "username" || key === "user" || key === "ssh user" || key === "ssh username") && !lineUser) {
          lineUser = val;
        } else if ((key === "password" || key === "pass" || key === "ssh password") && !linePass) {
          linePass = val;
        }
      }
    }
    if (lineUser || linePass) {
      return {
        username: lineUser,
        password: linePass,
      };
    }
    return null;
  }

  if (lowered.startsWith("l2tp")) {
    if (!isObject(parsed)) return null;
    return {
      username: pickString(parsed.username) ?? "",
      password: pickString(parsed.password) ?? "",
    };
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

  if (lowered.startsWith("ssh") || lowered.includes("ssh")) {
    if (pickString(parsed.type)?.toLowerCase() === "dnstt-ssh" && isObject(parsed.ssh)) {
      const ssh = { ...parsed.ssh };
      if (nextUsername !== undefined) {
        ssh.user = nextUsername;
        if (ssh.username !== undefined) ssh.username = nextUsername;
      }
      if (nextPassword !== undefined) {
        if (nextPassword) {
          ssh.password = nextPassword;
          if (ssh.pass !== undefined) ssh.pass = nextPassword;
        } else {
          delete ssh.password;
          delete ssh.pass;
        }
      }
      parsed.ssh = ssh;
      return JSON.stringify(parsed, null, 2);
    }
    if (nextUsername !== undefined) {
      if (parsed.username !== undefined && parsed.user === undefined) {
        parsed.username = nextUsername;
      } else {
        parsed.user = nextUsername;
        if (parsed.username !== undefined) parsed.username = nextUsername;
      }
    }
    if (nextPassword !== undefined) {
      if (nextPassword) {
        parsed.password = nextPassword;
        if (parsed.pass !== undefined) parsed.pass = nextPassword;
      } else {
        delete parsed.password;
        delete parsed.pass;
      }
    }
    return JSON.stringify(parsed, null, 2);
  }

  if (lowered.startsWith("l2tp")) {
    if (nextUsername !== undefined) parsed.username = nextUsername;
    if (nextPassword !== undefined) {
      if (nextPassword) parsed.password = nextPassword;
      else delete parsed.password;
    }
    if (typeof (update as { psk?: string }).psk === "string") {
      const nextPsk = ((update as { psk?: string }).psk ?? "").trim();
      if (nextPsk) parsed.psk = nextPsk;
    }
    return JSON.stringify(parsed, null, 2);
  }

  throw new Error(`Protocol ${protocol} does not support credential updates`);
};
