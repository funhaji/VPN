"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./download.css";

/* ------------------------------------------------------------------ */
/* Download endpoints                                                  */
/* ------------------------------------------------------------------ */

// Same-site endpoints. Each one 302s to a short-lived signed link on the
// download CDN, so the real file location is never shipped to the browser.
const FILES = {
  windows: "/api/download/windows",
  arm64: "/api/download/arm64",
  armv7: "/api/download/armv7",
  universal: "/api/download/universal",
  deb: "/api/download/deb",
  rpm: "/api/download/rpm",
  appimage: "/api/download/appimage",
} as const;

type Lang = "en" | "fa";
type Platform = "android" | "windows" | "linux" | "ios" | "mac" | "unknown";

type Country = { code: string; name: string; nameFa: string; flag: string; count: number };

type Stats = {
  locations: number | null;
  servers: number | null;
  countries: Country[];
  android: string | null;
  windows: string | null;
};

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

const COPY = {
  en: {
    navDownloads: "Downloads",
    navLocations: "Locations",
    headline1: "Connect anywhere.",
    headline2: "Even here.",
    lede: "A fast, private tunnel built for networks that try to block you. Keys are made on your device and nothing is logged.",
    downloadFor: "Download for",
    otherDevices: "Other devices",
    noApple: "There's no iPhone or Mac build yet. You can grab Astro for Android, Windows or Linux below.",
    seeAll: "See all downloads",
    online: "online now",
    countries: "countries",
    servers: "servers",
    viewAll: "View all locations",
    allDownloads: "All downloads",
    allDownloadsNote: "Every build comes from the same code and downloads over a fast, encrypted connection.",
    yourDevice: "Your device",
    androidReq: "Android 8.0 and newer",
    windowsReq: "Windows 10 & 11, 64-bit",
    linuxReq: "Debian, Ubuntu, Fedora, Arch",
    recommended: "Recommended",
    arm64Label: "ARM64",
    v7aLabel: "ARMv7",
    v7aSub: "32-bit",
    universalLabel: "Universal",
    apkHint: "Not sure which one? Pick ARM64 — it fits nearly every phone made since 2017. Pick ARMv7 for older 32-bit devices, or Universal for any device.",
    installer: "Installer",
    howTitle: "Installing on Android",
    how: [
      ["Download the APK", "Tap the ARM64 button. The file goes to your Downloads folder."],
      ["Allow the install", "Android will ask to allow apps from your browser. Allow it once, then go back."],
      ["Open and connect", "Launch Astro, pick a location or let it choose the fastest one."],
    ],
    specsTitle: "Under the hood",
    specs: [
      ["Protocols", "WireGuard, Xray (VLESS Reality, VMess, Trojan) and L2TP/IPsec in one client."],
      ["Transports", "xHTTP, gRPC and WebSocket, tuned to get past deep packet inspection."],
      ["Keys", "Credentials are generated on your hardware and never leave it."],
      ["Split routing", "Local banks and domestic sites can skip the tunnel so they keep working."],
    ],
    source: "Source on GitHub",
    panel: "Control panel",
    foot: "Astro VPN",
    sheetTitle: "Server locations",
    search: "Search country or code",
    empty: "No country matches that.",
    unavailable: "The location list isn't available right now.",
    close: "Close",
  },
  fa: {
    navDownloads: "دانلود",
    navLocations: "لوکیشن‌ها",
    headline1: "هر جا وصل شو.",
    headline2: "حتی اینجا.",
    lede: "تونلی سریع و خصوصی، ساخته‌شده برای شبکه‌هایی که سعی می‌کنند جلویت را بگیرند. کلیدها روی دستگاه خودت ساخته می‌شوند و هیچ لاگی ثبت نمی‌شود.",
    downloadFor: "دانلود برای",
    otherDevices: "دستگاه‌های دیگر",
    noApple: "فعلاً نسخه آیفون و مک نداریم. نسخه اندروید، ویندوز و لینوکس را از پایین صفحه دریافت کن.",
    seeAll: "همه نسخه‌ها",
    online: "آنلاین",
    countries: "کشور",
    servers: "سرور",
    viewAll: "مشاهده همه لوکیشن‌ها",
    allDownloads: "همه نسخه‌ها",
    allDownloadsNote: "همه نسخه‌ها از یک کد ساخته می‌شوند و از طریق یک اتصال سریع و امن دانلود می‌شوند.",
    yourDevice: "دستگاه تو",
    androidReq: "اندروید ۸ و بالاتر",
    windowsReq: "ویندوز ۱۰ و ۱۱ (۶۴ بیتی)",
    linuxReq: "دبیان، اوبونتو، فدورا، آرچ",
    recommended: "پیشنهادی",
    arm64Label: "ARM64",
    v7aLabel: "ARMv7",
    v7aSub: "۳۲ بیتی",
    universalLabel: "Universal",
    apkHint: "مطمئن نیستی کدام؟ ARM64 را بگیر؛ تقریباً روی همه گوشی‌های بعد از ۲۰۱۷ کار می‌کند. برای گوشی‌های قدیمی ۳۲ بیتی ARMv7\u200f، و اگر باز هم مطمئن نیستی Universal را نصب کن که روی همه دستگاه‌ها کار می‌کند.",
    installer: "فایل نصب",
    howTitle: "نصب روی اندروید",
    how: [
      ["فایل APK را دانلود کن", "دکمه ARM64 را بزن. فایل در پوشه دانلودها (Downloads) ذخیره می‌شود."],
      ["اجازه نصب بده", "اندروید می‌پرسد اجازه نصب برنامه از مرورگر را می‌دهی یا نه. یک بار اجازه بده و برگرد."],
      ["باز کن و وصل شو", "اَسترو را باز کن، یک لوکیشن انتخاب کن یا بگذار سریع‌ترین را خودش پیدا کند."],
    ],
    specsTitle: "مشخصات فنی",
    specs: [
      ["پروتکل‌ها", "وایرگارد، Xray (VLESS Reality،\u200f VMess،\u200f Trojan) و L2TP/IPsec، همه در یک برنامه."],
      ["روش‌های انتقال", "xHTTP،\u200f gRPC و وب‌سوکت، بهینه‌شده برای عبور از فیلترینگ و DPI."],
      ["کلیدها", "کلیدهای رمزنگاری روی دستگاه خودت ساخته می‌شوند و هیچ‌وقت از آن خارج نمی‌شوند."],
      ["تونل‌گذاری جداگانه (Split)", "بانک‌ها و سایت‌های داخلی می‌توانند بیرون از تونل بمانند تا بدون مشکل کار کنند."],
    ],
    source: "سورس در گیت‌هاب",
    panel: "پنل مدیریت",
    foot: "اَسترو VPN",
    sheetTitle: "لوکیشن سرورها",
    search: "جستجوی کشور یا کد",
    empty: "کشوری با این نام پیدا نشد.",
    unavailable: "فهرست لوکیشن‌ها الان در دسترس نیست.",
    close: "بستن",
  },
} as const;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const faNum = new Intl.NumberFormat("fa-IR");
const fmt = (n: number | null, lang: Lang) => (n == null ? "—" : lang === "fa" ? faNum.format(n) : String(n));
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const toFaDigits = (s: string) => s.replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
const idx = (n: number, lang: Lang) => {
  const s = String(n).padStart(2, "0");
  return lang === "fa" ? toFaDigits(s) : s;
};

/** Normalise text for search: Arabic ي/ك → Persian ی/ک, Persian/Arabic digits → Latin, drop ZWNJ/diacritics. */
function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[يىئ]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ةۀ]/g, "ه")
    .replace(/[أإآ]/g, "ا")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u200c\u200f\u064b-\u065f\u0670]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/macintosh|mac os x/i.test(ua)) return navigator.maxTouchPoints > 1 ? "ios" : "mac";
  if (/windows/i.test(ua)) return "windows";
  if (/linux|x11|cros/i.test(ua)) return "linux";
  return "unknown";
}

function detectLang(): Lang {
  try {
    const s = localStorage.getItem("astro-lang");
    if (s === "en" || s === "fa") return s;
  } catch {}
  return (navigator.language || "").toLowerCase().startsWith("fa") ? "fa" : "en";
}

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function DownloadPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [ready, setReady] = useState(false);
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [stats, setStats] = useState<Stats>({ locations: null, servers: null, countries: [], android: null, windows: null });
  const [query, setQuery] = useState("");
  const sheetRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setLang(detectLang());
    setPlatform(detectPlatform());
    setReady(true);

    type V = { android?: string; windows?: string; locations?: number; servers?: number };
    type S = { locations?: number; servers?: number; countries?: Country[] };
    Promise.all([getJSON<V>("/api/client/version"), getJSON<S>("/api/stats")]).then(([v, s]) => {
      const num = (x: unknown) => (typeof x === "number" ? x : null);
      setStats({
        android: v?.android ?? null,
        windows: v?.windows ?? null,
        locations: num(s?.locations) ?? num(v?.locations),
        servers: num(s?.servers) ?? num(v?.servers),
        countries: Array.isArray(s?.countries) ? [...s.countries].sort((a, b) => b.count - a.count) : [],
      });
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === "fa" ? "rtl" : "ltr";
    // Set by the pre-hydration script in layout.tsx to avoid an English flash.
    html.removeAttribute("data-boot-lang");
  }, [lang, ready]);

  const switchLang = useCallback((next: Lang) => {
    setLang(next);
    try {
      localStorage.setItem("astro-lang", next);
    } catch {}
  }, []);

  const openSheet = useCallback(() => {
    setQuery("");
    sheetRef.current?.showModal();
  }, []);
  const closeSheet = useCallback(() => sheetRef.current?.close(), []);

  const t = COPY[lang];
  const fa = lang === "fa";

  const filtered = useMemo(() => {
    const q = normalizeSearch(query);
    if (!q) return stats.countries;
    return stats.countries.filter((c) =>
      [c.name, c.nameFa, c.code].some((v) => typeof v === "string" && normalizeSearch(v).includes(q))
    );
  }, [query, stats.countries]);

  const primary = useMemo(() => {
    if (platform === "android")
      return { name: fa ? "اندروید" : "Android", href: FILES.arm64, meta: ["ARM64", "APK", stats.android && `v${stats.android}`] };
    if (platform === "linux")
      return { name: fa ? "لینوکس" : "Linux", href: FILES.appimage, meta: ["AppImage", "x64"] };
    if (platform === "ios" || platform === "mac") return null;
    return { name: fa ? "ویندوز" : "Windows", href: FILES.windows, meta: [".exe", "64-bit", stats.windows && `v${stats.windows}`] };
  }, [platform, fa, stats.android, stats.windows]);

  const ticker = stats.countries.slice(0, 24);

  return (
    <div className="dl" data-lang={lang} dir={fa ? "rtl" : "ltr"} lang={lang}>
      <header className="dl-bar">
        <a className="dl-mark" href="#top" aria-label="Astro VPN">
          <Mark />
          <span>astro</span>
        </a>
        <nav className="dl-nav" aria-label="Page">
          <a href="#downloads">{t.navDownloads}</a>
          <button type="button" onClick={openSheet}>{t.navLocations}</button>
        </nav>
        <div className="dl-lang" role="group" aria-label="Language">
          <button type="button" aria-pressed={!fa} onClick={() => switchLang("en")}>EN</button>
          <button type="button" aria-pressed={fa} onClick={() => switchLang("fa")} lang="fa">فا</button>
        </div>
      </header>

      <main id="top">
        {/* ---------------------------------------------------------- Hero */}
        <section className="dl-hero">
          <div className="dl-hero-copy">
            <h1 className="dl-h1">
              <span>{t.headline1}</span>
              <span className="dl-h1-2">{t.headline2}</span>
            </h1>
            <p className="dl-lede">{t.lede}</p>

            {primary ? (
              <div className="dl-cta">
                <a className="dl-btn" href={primary.href} rel="nofollow">
                  <DownloadIcon />
                  <span>
                    {t.downloadFor} {primary.name}
                  </span>
                </a>
                <p className="dl-cta-meta" dir="ltr">
                  {primary.meta.filter(Boolean).join("  ·  ")}
                </p>
              </div>
            ) : (
              <div className="dl-cta">
                <p className="dl-note">{t.noApple}</p>
                <a className="dl-btn dl-btn-ghost" href="#downloads">
                  {t.seeAll}
                  <Arrow down />
                </a>
              </div>
            )}

            {primary && (
              <a className="dl-other" href="#downloads">
                {t.otherDevices}
                <Arrow down />
              </a>
            )}
          </div>

          <button type="button" className="dl-stat" onClick={openSheet} aria-label={t.viewAll}>
            <span className="dl-stat-live">
              <i aria-hidden="true" />
              {t.online}
            </span>
            <span className="dl-stat-num">{fmt(stats.locations, lang)}</span>
            <span className="dl-stat-row">
              <span>{t.countries}</span>
              <span className="dl-stat-sep" aria-hidden="true" />
              <span>
                {fmt(stats.servers, lang)} {t.servers}
              </span>
            </span>
            <span className="dl-stat-link">
              {t.viewAll}
              <Arrow />
            </span>
          </button>
        </section>

        {/* ---------------------------------------------------------- Ticker */}
        {ticker.length > 0 && (
          <div className="dl-ticker" aria-hidden="true">
            <div className="dl-ticker-track" style={{ animationDuration: `${ticker.length * 3.2}s` }}>
              {[0, 1].map((k) => (
                <ul key={k}>
                  {ticker.map((c) => (
                    <li key={c.code}>
                      <b>{c.code}</b>
                      {fa ? c.nameFa || c.name : c.name}
                      <em>{fmt(c.count, lang)}</em>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------- Downloads */}
        <section id="downloads" className="dl-section">
          <div className="dl-section-head">
            <h2>{t.allDownloads}</h2>
            <p>{t.allDownloadsNote}</p>
          </div>

          <ol className="dl-rows">
            <li className="dl-row" data-mine={platform === "android" || undefined}>
              <div className="dl-row-id">
                <span className="dl-idx">{idx(1, lang)}</span>
                <AndroidIcon />
              </div>
              <div className="dl-row-info">
                <h3>
                  {fa ? "اندروید" : "Android"}
                  {platform === "android" && <span className="dl-tag">{t.yourDevice}</span>}
                </h3>
                <p>
                  {t.androidReq}
                  {stats.android && <span className="dl-ver" dir="ltr">v{stats.android}</span>}
                </p>
              </div>
              <div className="dl-row-files dl-row-files-3">
                <a className="dl-file dl-file-main" href={FILES.arm64} rel="nofollow">
                  <span>
                    {t.arm64Label}
                    <small>{t.recommended}</small>
                  </span>
                  <DownloadIcon />
                </a>
                <a className="dl-file" href={FILES.armv7} rel="nofollow">
                  <span>
                    {t.v7aLabel}
                    <small>{t.v7aSub}</small>
                  </span>
                  <DownloadIcon />
                </a>
                <a className="dl-file" href={FILES.universal} rel="nofollow">
                  <span>{t.universalLabel}</span>
                  <DownloadIcon />
                </a>
              </div>
              <p className="dl-row-hint">{t.apkHint}</p>
            </li>

            <li className="dl-row" data-mine={platform === "windows" || undefined}>
              <div className="dl-row-id">
                <span className="dl-idx">{idx(2, lang)}</span>
                <WindowsIcon />
              </div>
              <div className="dl-row-info">
                <h3>
                  {fa ? "ویندوز" : "Windows"}
                  {platform === "windows" && <span className="dl-tag">{t.yourDevice}</span>}
                </h3>
                <p>
                  {t.windowsReq}
                  {stats.windows && <span className="dl-ver" dir="ltr">v{stats.windows}</span>}
                </p>
              </div>
              <div className="dl-row-files">
                <a className="dl-file dl-file-main" href={FILES.windows} rel="nofollow">
                  <span>
                    {t.installer}
                    <small dir="ltr">.exe</small>
                  </span>
                  <DownloadIcon />
                </a>
              </div>
            </li>

            <li className="dl-row" data-mine={platform === "linux" || undefined}>
              <div className="dl-row-id">
                <span className="dl-idx">{idx(3, lang)}</span>
                <LinuxIcon />
              </div>
              <div className="dl-row-info">
                <h3>
                  {fa ? "لینوکس" : "Linux"}
                  {platform === "linux" && <span className="dl-tag">{t.yourDevice}</span>}
                </h3>
                <p>{t.linuxReq}</p>
              </div>
              <div className="dl-row-files dl-row-files-3 dl-row-files-mono" dir="ltr">
                <a className="dl-file" href={FILES.deb} rel="nofollow">
                  <span>.deb</span>
                  <DownloadIcon />
                </a>
                <a className="dl-file" href={FILES.rpm} rel="nofollow">
                  <span>.rpm</span>
                  <DownloadIcon />
                </a>
                <a className="dl-file" href={FILES.appimage} rel="nofollow">
                  <span>AppImage</span>
                  <DownloadIcon />
                </a>
              </div>
            </li>
          </ol>
        </section>

        {/* ---------------------------------------------------------- Android install */}
        <section className="dl-section">
          <div className="dl-section-head">
            <h2>{t.howTitle}</h2>
          </div>
          <ol className="dl-steps">
            {t.how.map(([h, p], i) => (
              <li key={h}>
                <span className="dl-step-n">{fmt(i + 1, lang)}</span>
                <h3>{h}</h3>
                <p>{p}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------------------------------------------------------- Specs */}
        <section className="dl-section">
          <div className="dl-section-head">
            <h2>{t.specsTitle}</h2>
          </div>
          <dl className="dl-specs">
            {t.specs.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="dl-foot">
        <span className="dl-foot-mark">
          <Mark />
          {t.foot}
        </span>
      </footer>

      {/* ---------------------------------------------------------- Locations sheet */}
      <dialog
        ref={sheetRef}
        className="dl-sheet"
        aria-labelledby="dl-sheet-title"
        onClick={(e) => e.target === e.currentTarget && closeSheet()}
      >
        <div className="dl-sheet-in">
          <div className="dl-sheet-head">
            <div>
              <h2 id="dl-sheet-title">{t.sheetTitle}</h2>
              <p>
                <bdi>{fmt(stats.locations, lang)} {t.countries}</bdi> · <bdi>{fmt(stats.servers, lang)} {t.servers}</bdi>
              </p>
            </div>
            <button type="button" className="dl-x" onClick={closeSheet} aria-label={t.close}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <input
            className="dl-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search}
            aria-label={t.search}
            autoComplete="off"
            enterKeyHint="search"
          />
          <ul className="dl-list">
            {filtered.map((c) => (
              <li key={c.code}>
                <span className="dl-flag" aria-hidden="true">{c.flag}</span>
                <span className="dl-cname">{fa ? c.nameFa || c.name : c.name}</span>
                <span className="dl-ccode">{c.code}</span>
                <span className="dl-ccount">
                  {fmt(c.count, lang)}
                </span>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && (
            <p className="dl-empty">{stats.countries.length === 0 ? t.unavailable : t.empty}</p>
          )}
        </div>
      </dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="10.5" ry="4.2" transform="rotate(-28 12 12)" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function Arrow({ down }: { down?: boolean }) {
  return (
    <svg className={down ? "dl-arrow dl-arrow-down" : "dl-arrow"} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 5.1l7.4-1v7.2H3V5.1zm8.3-1.2L21 2.5v8.8h-9.7V3.9zM3 12.6h7.4v7.3L3 18.9v-6.3zm8.3 0H21v8.9l-9.7-1.4v-7.5z" />
    </svg>
  );
}

function AndroidIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.6 9.5l1.8-3.1a.4.4 0 0 0-.7-.4l-1.8 3.1A11 11 0 0 0 12 8.1c-1.8 0-3.4.4-4.9 1L5.3 6a.4.4 0 1 0-.7.4l1.8 3.1A9.6 9.6 0 0 0 1.5 17h21a9.6 9.6 0 0 0-4.9-7.5zM7 14.4a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm10 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16v12H4z" />
      <path d="M8 21h8M12 17v4" />
      <path d="M7.5 9l2.5 2-2.5 2M12 13h4" />
    </svg>
  );
}
