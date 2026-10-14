export type CountryMeta = {
  code: string;
  name: string;
  flag: string;
};

export const ISO_REGION_CODES = [
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

const countryDisplayNamesEn = new Intl.DisplayNames(["en"], { type: "region" });
const countryDisplayNamesFa = new Intl.DisplayNames(["fa"], { type: "region" });

export const flagFromCountryCode = (code: string): string => {
  const upper = code.trim().toUpperCase();
  if (upper.length === 2 && upper !== "XX" && (ISO_REGION_CODES as readonly string[]).includes(upper)) {
    return upper.replace(/[A-Z]/g, (letter) =>
      String.fromCodePoint(127397 + letter.charCodeAt(0))
    );
  }
  return "🌐";
};

export const extractFlagIsoCode = (text: string): string | null => {
  const codePoints = Array.from(text);
  for (let i = 0; i < codePoints.length - 1; i++) {
    const cp0 = codePoints[i].codePointAt(0) ?? 0;
    const cp1 = codePoints[i + 1].codePointAt(0) ?? 0;
    if (cp0 >= 0x1f1e6 && cp0 <= 0x1f1ff && cp1 >= 0x1f1e6 && cp1 <= 0x1f1ff) {
      const code = String.fromCharCode(cp0 - 127397) + String.fromCharCode(cp1 - 127397);
      if ((ISO_REGION_CODES as readonly string[]).includes(code)) {
        return code;
      }
    }
  }
  return null;
};

export const normalizeLocationCode = (raw: string | null | undefined): string => {
  if (!raw) return "GLOBAL";
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "XX" || trimmed === "GLOBAL") return "GLOBAL";

  // 1. Scan for any emoji flag pair anywhere near the start or throughout the string
  const flagCode = extractFlagIsoCode(trimmed);
  if (flagCode) {
    return flagCode;
  }

  // 2. Check if the string itself is a valid 2-letter ISO region code
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && upper !== "XX" && (ISO_REGION_CODES as readonly string[]).includes(upper)) {
    return upper;
  }

  // 3. Strip leading flag/symbols and trailing indexes
  const withoutLeadingFlag = trimmed.replace(
    /^(?:[\u{1F1E6}-\u{1F1FF}]{2}|[\p{Emoji_Presentation}\p{Extended_Pictographic}])\s*/u,
    ""
  ).trim();
  const cleaned = withoutLeadingFlag.replace(/\s*#?\d+$/, "").trim();

  const cleanedUpper = cleaned.toUpperCase();
  if (/^[A-Z]{2}$/.test(cleanedUpper) && cleanedUpper !== "XX" && (ISO_REGION_CODES as readonly string[]).includes(cleanedUpper)) {
    return cleanedUpper;
  }

  // 4. Match against known region display names (English)
  const lower = cleaned.toLowerCase();
  for (const code of ISO_REGION_CODES) {
    const name = countryDisplayNamesEn.of(code)?.toLowerCase();
    if (name && (name === lower || lower.startsWith(name))) {
      return code;
    }
  }

  return "GLOBAL";
};

export const getCountryMeta = (codeOrRaw: string): CountryMeta => {
  const code = normalizeLocationCode(codeOrRaw);
  const flag = flagFromCountryCode(code);
  let name = code;
  if (/^[A-Z]{2}$/.test(code)) {
    name = countryDisplayNamesEn.of(code) ?? code;
  }
  return { code, name, flag };
};

export const getCountryNameFa = (code: string): string => {
  if (/^[A-Z]{2}$/.test(code)) {
    return countryDisplayNamesFa.of(code) ?? code;
  }
  return code;
};

export const COUNTRIES: CountryMeta[] = ISO_REGION_CODES.map((code) => ({
  code,
  flag: flagFromCountryCode(code),
  name: countryDisplayNamesEn.of(code) ?? code,
})).sort((a, b) => a.name.localeCompare(b.name));
