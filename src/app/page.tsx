"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";

const WINDOWS_URL = "/api/download/windows";
const DEB_URL = "/api/download/deb";
const RPM_URL = "/api/download/rpm";
const APPIMAGE_URL = "/api/download/appimage";
const ANDROID_ARM64_URL = "/api/download/arm64";
const ANDROID_UNIVERSAL_URL = "/api/download/universal";

type Lang = "en" | "fa";

type CountryInfo = {
  code: string;
  name: string;
  nameFa: string;
  flag: string;
  count: number;
};

type NetworkStats = {
  locations: number;
  servers: number;
  countries: CountryInfo[];
  androidVersion: string;
  windowsVersion: string;
};

const COPY: Record<
  Lang,
  {
    liveNetwork: string;
    locationsWorldwide: string;
    viewLocations: string;
    closeLocations: string;
    searchLocationsPlaceholder: string;
    noLocationsFound: string;
    serversCount: string;
    status: string;
    tagline: string;
    ticker: string[];
    winTitle: string;
    winSub: string;
    winCta: string;
    linuxTitle: string;
    linuxSub: string;
    androidTitle: string;
    androidSub: string;
    androidUniversal: string;
    androidArm64: string;
    architectureTitle: string;
    archProtocol: string;
    archProtocolDesc: string;
    archSecurity: string;
    archSecurityDesc: string;
    archBypass: string;
    archBypassDesc: string;
    archRouting: string;
    archRoutingDesc: string;
    footnote: string;
  }
> = {
  en: {
    liveNetwork: "Live Network",
    locationsWorldwide: "Global Locations",
    viewLocations: "View Covered Locations",
    closeLocations: "Close",
    searchLocationsPlaceholder: "Search countries by name or code...",
    noLocationsFound: "No locations match your search.",
    serversCount: "servers",
    status: "device-generated keys, zero server logs kept",
    tagline: "High-performance privacy tunnel engineered for hostile network environments.",
    ticker: [
      "key exchange settled locally",
      "cipher chacha20-poly1305 active",
      "routes obfuscated against inspection",
      "traffic shape randomized",
      "dns leak probe returned clean",
      "dynamic failover standby",
    ],
    winTitle: "Windows",
    winSub: "Windows 10 / 11, 64-bit",
    winCta: "Download Installer (.exe)",
    linuxTitle: "Linux",
    linuxSub: "Debian, Ubuntu, Fedora, Arch",
    androidTitle: "Android",
    androidSub: "Android 8.0+ (Universal & ARM64)",
    androidUniversal: "Universal (Legacy/x86)",
    androidArm64: "ARM64-v8a (Recommended)",
    architectureTitle: "Core Network Specifications",
    archProtocol: "Multi-Protocol Engine",
    archProtocolDesc: "Native support for WireGuard, V2Ray/Xray (VLESS Reality, VMess, Trojan), and L2TP IPsec.",
    archSecurity: "Device-Bound Security",
    archSecurityDesc: "Cryptographic credentials are generated on your hardware and never leave your machine.",
    archBypass: "Resilient Transports",
    archBypassDesc: "Hardened xHTTP, gRPC, and WebSocket transports designed to pass deep packet inspection.",
    archRouting: "Smart Direct Bypass",
    archRoutingDesc: "Configurable direct routing for domestic sites and local banking services.",
    footnote: "Built for speed, reliability, and cryptographic privacy across all desktop and mobile devices.",
  },
  fa: {
    liveNetwork: "شبکه فعال",
    locationsWorldwide: "لوکیشن جهانی",
    viewLocations: "مشاهده کشورهای تحت پوشش",
    closeLocations: "بستن",
    searchLocationsPlaceholder: "جستجوی کشور یا کد منطقه...",
    noLocationsFound: "کشوری مطابق جستجو یافت نشد.",
    serversCount: "سرور",
    status: "کلیدها فقط روی دستگاه تولید می‌شوند، بدون هیچ لاگ سرور",
    tagline: "تونل فوق‌سریع و امن ضدسانسور، بهینه‌سازی‌شده برای شرایط سخت شبکه.",
    ticker: [
      "تبادل کلید به‌صورت محلی انجام شد",
      "رمزنگاری chacha20-poly1305 فعال است",
      "مسیرها در برابر فیلترینگ مبهم‌سازی شدند",
      "شکل بسته‌های داده تصادفی شد",
      "بررسی نشت دی‌ان‌اس تمیز بود",
      "اتصال خودکار به نزدیک‌ترین سرور آماده است",
    ],
    winTitle: "ویندوز",
    winSub: "ویندوز ۱۰ و ۱۱، ۶۴ بیتی",
    winCta: "دریافت فایل نصب (.exe)",
    linuxTitle: "لینوکس",
    linuxSub: "دبیان، اوبونتو، فدورا، آرچ",
    androidTitle: "اندروید",
    androidSub: "اندروید ۸.۰ به بالا (Universal و ARM64)",
    androidUniversal: "نسخه Universal (همه گوشی‌ها)",
    androidArm64: "نسخه ARM64-v8a (پیشنهادی)",
    architectureTitle: "مشخصات فنی و امنیتی",
    archProtocol: "موتور چندپروتکله",
    archProtocolDesc: "پشتیبانی قدرتمند از وایرگارد، وی‌تو‌ری (VLESS Reality، VMess، Trojan) و L2TP IPsec.",
    archSecurity: "امنیت متکی بر دستگاه",
    archSecurityDesc: "تمام کلیدهای رمزنگاری روی دستگاه شما ساخته شده و هرگز به سرور فرستاده نمی‌شوند.",
    archBypass: "انتقال مقاوم به سانسور",
    archBypassDesc: "پروتکل‌های تقویت‌شده xHTTP، gRPC و وب‌سوکت برای عبور از فیلترینگ شدید.",
    archRouting: "مسیریابی هوشمند سایت‌های داخلی",
    archRoutingDesc: "امکان عبور مستقیم ترافیک سایت‌های بانکی و سرویس‌های داخلی بدون قطعی تونل.",
    footnote: "طراحی شده برای سرعت، پایداری و امنیت کامل در تمام سیستم‌عامل‌های رایانه و موبایل.",
  },
};

const GLYPHS = "01ABCDEF#$%&アイウエオカキクケコ";

function useScramble(text: string, delayMs: number) {
  const [display, setDisplay] = useState(text);

  useEffect(() => {
    let raf: number;
    let start: number | null = null;

    const timeout = setTimeout(() => {
      const step = (t: number) => {
        if (start === null) start = t;
        const elapsed = t - start;
        const progress = Math.min(elapsed / 650, 1);
        const revealCount = Math.floor(progress * text.length);

        let out = "";
        for (let i = 0; i < text.length; i++) {
          if (text[i] === " ") {
            out += " ";
          } else if (i < revealCount) {
            out += text[i];
          } else {
            out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          }
        }
        setDisplay(out);

        if (progress < 1) {
          raf = requestAnimationFrame(step);
        } else {
          setDisplay(text);
        }
      };
      raf = requestAnimationFrame(step);
    }, delayMs);

    return () => {
      clearTimeout(timeout);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [text, delayMs]);

  return display;
}

function TunnelField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Only run animated canvas on desktop viewports (>= 768px) to prevent mobile GPU thermal throttling and lag
    if (typeof window === "undefined" || window.innerWidth < 768) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const rings = 24;
    const pulses = Array.from({ length: 4 }, (_, i) => ({
      offset: i / 4,
      speed: 0.00025 + i * 0.00003,
    }));

    let raf: number;
    const start = performance.now();

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const draw = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height * 0.38;
      const maxR = Math.hypot(width, height) * 0.6;

      for (let i = 0; i < rings; i++) {
        const rp = i / rings;
        const wobble = prefersReduced ? 0 : Math.sin(t * 0.0005 + i * 0.55) * 2.5;
        const r = 35 + rp * maxR + wobble;
        const alpha = (1 - rp) * 0.11;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.58, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(34, 211, 238, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (!prefersReduced) {
        pulses.forEach((p) => {
          const progress = (t * p.speed + p.offset) % 1;
          const r = 35 + progress * maxR;
          const alpha = Math.sin(progress * Math.PI) * 0.85;
          ctx.beginPath();
          ctx.ellipse(cx, cy, r, r * 0.58, 0, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(99, 102, 241, ${alpha * 0.45})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.beginPath();
          ctx.ellipse(cx, cy, r * 0.998, r * 0.58 * 0.998, 0, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(34, 211, 238, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        });
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="tunnel-canvas" aria-hidden="true" />;
}

function StatusTicker({ lines: messages }: { lines: string[] }) {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    setLines([]);
    let i = 0;
    const id = setInterval(() => {
      setLines((prev) => {
        const next = [...prev, messages[i % messages.length]];
        i++;
        return next.slice(-3);
      });
    }, 1800);
    return () => clearInterval(id);
  }, [messages]);

  return (
    <div className="ticker" aria-hidden="true">
      {lines.map((line, idx) => (
        <div
          key={idx}
          className="ticker-line"
          style={{ opacity: 0.35 + (idx / Math.max(1, lines.length)) * 0.65 }}
        >
          <span className="ticker-dot" />
          <span>{line}</span>
        </div>
      ))}
    </div>
  );
}

function detectLang(): Lang {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem("astro-lang");
  if (stored === "en" || stored === "fa") return stored;
  const nav = window.navigator.language || "";
  return nav.toLowerCase().startsWith("fa") ? "fa" : "en";
}

export default function DownloadPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [mounted, setMounted] = useState(false);
  const [showLocationsModal, setShowLocationsModal] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");
  const [stats, setStats] = useState<NetworkStats>({
    locations: 62,
    servers: 96,
    countries: [],
    androidVersion: "1.1.2",
    windowsVersion: "1.1.1",
  });

  useEffect(() => {
    setLang(detectLang());
    setMounted(true);

    // Fetch dynamic network telemetry and country coverage
    const loadStats = async () => {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data.locations === "number") {
            setStats((prev) => ({
              ...prev,
              locations: data.locations || prev.locations,
              servers: data.servers || prev.servers,
              countries: Array.isArray(data.countries) ? data.countries : prev.countries,
            }));
          }
        }
      } catch {}

      try {
        const vRes = await fetch("/api/client/version", { cache: "no-store" });
        if (vRes.ok) {
          const vData = await vRes.json();
          if (vData) {
            setStats((prev) => ({
              ...prev,
              androidVersion: vData.android || prev.androidVersion,
              windowsVersion: vData.windows || prev.windowsVersion,
              locations: vData.locations || prev.locations,
              servers: vData.servers || prev.servers,
            }));
          }
        }
      } catch {}
    };

    void loadStats();
  }, []);

  const toggleLang = useCallback(() => {
    setLang((prev) => {
      const next = prev === "en" ? "fa" : "en";
      window.localStorage.setItem("astro-lang", next);
      return next;
    });
  }, []);

  // Handle escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showLocationsModal) {
        setShowLocationsModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showLocationsModal]);

  const c = COPY[lang];
  const title = useScramble("ASTROVPN", 150);
  const isRtl = lang === "fa";

  const filteredCountries = useMemo(() => {
    const q = locationSearch.trim().toLowerCase();
    if (!q) return stats.countries;
    return stats.countries.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.nameFa.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q)
    );
  }, [locationSearch, stats.countries]);

  return (
    <main
      className="page"
      dir={isRtl ? "rtl" : "ltr"}
      lang={lang}
      data-lang={lang}
    >
      <TunnelField />
      <div className="vignette" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      {/* Responsive Top Bar */}
      <header className="top-bar">
        <div className="brand-badge">
          <span className="live-pulse" />
          <span className="brand-text">ASTRO VPN</span>
        </div>

        <div className="top-bar-right">
          <button
            type="button"
            onClick={() => setShowLocationsModal(true)}
            className="locations-header-pill"
            aria-label={isRtl ? "مشاهده لوکیشن‌های سرور" : "View active server locations"}
          >
            <span className="globe-icon" aria-hidden="true">🌐</span>
            <span className="font-semibold text-cyan-300">{stats.locations}</span>
            <span className="hidden sm:inline text-zinc-400">{c.locationsWorldwide}</span>
          </button>

          <button
            type="button"
            onClick={toggleLang}
            className="lang-toggle"
            aria-label={isRtl ? "Switch to English" : "تغییر به فارسی"}
          >
            {isRtl ? "EN" : "فا"}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className={`content ${mounted ? "content-in" : ""}`}>
        {/* Status indicator */}
        <div className="eyebrow">
          <span className="eyebrow-dot" />
          {c.status}
        </div>

        {/* Brand Title */}
        <h1 className="title" dir="ltr">
          {title}
        </h1>

        {/* Tagline */}
        <p className="tagline">{c.tagline}</p>

        {/* Global Locations Highlights Row */}
        <div className="locations-hero-card">
          <div className="locations-meta">
            <div className="locations-stat-box">
              <span className="locations-number">{stats.locations}</span>
              <span className="locations-label">{c.locationsWorldwide}</span>
            </div>
            <div className="locations-divider" />
            <div className="locations-stat-box">
              <span className="locations-number">{stats.servers}</span>
              <span className="locations-label">{isRtl ? "سرور فعال" : "Active Nodes"}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowLocationsModal(true)}
            className="locations-cta-btn"
          >
            <span>{c.viewLocations}</span>
            <span className="cta-arrow" aria-hidden="true">{isRtl ? "←" : "→"}</span>
          </button>
        </div>

        {/* Real-time Status Ticker */}
        <StatusTicker lines={c.ticker} />

        {/* Platform Downloads Grid */}
        <section className="downloads-section" aria-label="Downloads">
          {/* Windows Download Card */}
          <div className="card card-primary">
            <div className="card-top">
              <div className="flex items-center gap-2">
                <OsIconWindows />
                <span className="version-pill">v{stats.windowsVersion}</span>
              </div>
              <span className="platform-tag">64-bit</span>
            </div>
            <div className="card-body">
              <h2>{c.winTitle}</h2>
              <p>{c.winSub}</p>
            </div>
            <a
              href={WINDOWS_URL}
              download="Astro VPN_setup.exe"
              className="card-cta-btn"
              aria-label={`${c.winCta} for Windows`}
            >
              <span>{c.winCta}</span>
              <span className="card-arrow" aria-hidden="true">{isRtl ? "←" : "→"}</span>
            </a>
          </div>

          {/* Android Download Card */}
          <div className="card card-secondary">
            <div className="card-top">
              <div className="flex items-center gap-2">
                <OsIconAndroid />
                <span className="version-pill">v{stats.androidVersion}</span>
              </div>
              <span className="platform-tag">APK</span>
            </div>
            <div className="card-body">
              <h2>{c.androidTitle}</h2>
              <p>{c.androidSub}</p>
            </div>
            <div className="multi-links-grid">
              <a
                href={ANDROID_ARM64_URL}
                download="AstroVPN-arm64-v8a.apk"
                className="multi-link"
                aria-label={`Download ${c.androidArm64}`}
              >
                <span>{c.androidArm64}</span>
              </a>
              <a
                href={ANDROID_UNIVERSAL_URL}
                download="app-universal-release.apk"
                className="multi-link"
                aria-label={`Download ${c.androidUniversal}`}
              >
                <span>{c.androidUniversal}</span>
              </a>
            </div>
          </div>

          {/* Linux Download Card */}
          <div className="card card-secondary">
            <div className="card-top">
              <div className="flex items-center gap-2">
                <OsIconLinux />
                <span className="platform-tag">Linux</span>
              </div>
            </div>
            <div className="card-body">
              <h2>{c.linuxTitle}</h2>
              <p>{c.linuxSub}</p>
            </div>
            <div className="multi-links-grid">
              <a
                href={DEB_URL}
                download="AstroVPN.deb"
                className="multi-link"
                aria-label="Download Debian package"
              >
                <span>.deb</span>
              </a>
              <a
                href={RPM_URL}
                download="AstroVPN.rpm"
                className="multi-link"
                aria-label="Download RPM package"
              >
                <span>.rpm</span>
              </a>
              <a
                href={APPIMAGE_URL}
                download="AstroVPN.AppImage"
                className="multi-link"
                aria-label="Download AppImage"
              >
                <span>AppImage</span>
              </a>
            </div>
          </div>
        </section>

        {/* Technical Architecture Specs Section */}
        <section className="specs-section" aria-label="Technical Specifications">
          <h2 className="specs-title">{c.architectureTitle}</h2>
          <div className="specs-grid">
            <div className="spec-item">
              <div className="spec-icon-box" aria-hidden="true">⚡</div>
              <div className="spec-content">
                <h3>{c.archProtocol}</h3>
                <p>{c.archProtocolDesc}</p>
              </div>
            </div>

            <div className="spec-item">
              <div className="spec-icon-box" aria-hidden="true">🛡️</div>
              <div className="spec-content">
                <h3>{c.archSecurity}</h3>
                <p>{c.archSecurityDesc}</p>
              </div>
            </div>

            <div className="spec-item">
              <div className="spec-icon-box" aria-hidden="true">🌐</div>
              <div className="spec-content">
                <h3>{c.archBypass}</h3>
                <p>{c.archBypassDesc}</p>
              </div>
            </div>

            <div className="spec-item">
              <div className="spec-icon-box" aria-hidden="true">🔀</div>
              <div className="spec-content">
                <h3>{c.archRouting}</h3>
                <p>{c.archRoutingDesc}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Footnote */}
        <footer className="page-footer">
          <p className="footnote-text">{c.footnote}</p>
          <div className="footer-links">
            <a
              href="https://github.com/funhaji/AstroVPN"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link"
            >
              GitHub Source
            </a>
            <span className="text-zinc-700" aria-hidden="true">•</span>
            <a
              href="/admin"
              className="footer-link"
            >
              Control Panel
            </a>
          </div>
        </footer>
      </div>

      {/* Interactive Global Locations Modal / Drawer */}
      {showLocationsModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowLocationsModal(false)}
          role="dialog"
          aria-modal="true"
          aria-label={isRtl ? "فهرست لوکیشن‌های سرور" : "Global Server Locations"}
        >
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            dir={isRtl ? "rtl" : "ltr"}
          >
            <div className="modal-header">
              <div>
                <h3 className="modal-title">
                  {stats.locations} {c.locationsWorldwide}
                </h3>
                <p className="modal-subtitle">
                  {stats.servers} {isRtl ? "سرور فعال آماده اتصال" : "active servers ready for instant connection"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLocationsModal(false)}
                className="modal-close-btn"
                aria-label={c.closeLocations}
              >
                ✕
              </button>
            </div>

            {/* Country search input */}
            <div className="modal-search-wrap">
              <input
                type="text"
                value={locationSearch}
                onChange={(e) => setLocationSearch(e.target.value)}
                placeholder={c.searchLocationsPlaceholder}
                className="modal-search-input"
                autoFocus
              />
            </div>

            {/* Countries grid */}
            <div className="modal-countries-list">
              {filteredCountries.length > 0 ? (
                filteredCountries.map((cItem) => (
                  <div key={cItem.code} className="country-card">
                    <span className="country-flag" aria-hidden="true">{cItem.flag}</span>
                    <div className="country-info">
                      <span className="country-name">
                        {isRtl ? cItem.nameFa || cItem.name : cItem.name}
                      </span>
                      <span className="country-code">{cItem.code}</span>
                    </div>
                    <span className="country-badge">
                      {cItem.count} {c.serversCount}
                    </span>
                  </div>
                ))
              ) : (
                <div className="modal-empty-state">
                  <p>{c.noLocationsFound}</p>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                onClick={() => setShowLocationsModal(false)}
                className="modal-dismiss-btn"
              >
                {c.closeLocations}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .page {
          position: relative;
          min-height: 100vh;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 5.5rem 1rem 3rem;
          overflow-x: hidden;
          background: var(--void);
          isolation: isolate;
        }

        .page[data-lang="fa"] .content,
        .page[data-lang="fa"] .modal-dialog {
          font-family: var(--font-fa, "Vazirmatn", sans-serif);
        }

        .tunnel-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: 0;
          pointer-events: none;
        }

        .vignette {
          position: absolute;
          inset: 0;
          z-index: 1;
          background:
            radial-gradient(ellipse 80% 55% at 50% 36%, transparent 0%, var(--void) 80%),
            linear-gradient(180deg, var(--void-deep) 0%, transparent 18%, transparent 75%, var(--void-deep) 100%);
          pointer-events: none;
        }

        .grain {
          position: absolute;
          inset: 0;
          z-index: 2;
          opacity: 0.035;
          pointer-events: none;
          background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        }

        .top-bar {
          position: absolute;
          top: 1rem;
          inset-inline: 1rem;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: space-between;
          max-width: 68rem;
          margin: 0 auto;
        }

        @media (min-width: 640px) {
          .top-bar {
            top: 1.5rem;
            inset-inline: 2rem;
          }
        }

        .brand-badge {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.45rem 0.9rem;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: rgba(18, 18, 22, 0.7);
          backdrop-filter: blur(12px);
        }

        .live-pulse {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #10b981;
          box-shadow: 0 0 8px 1px #10b981;
        }

        .brand-text {
          font-family: var(--font-mono, monospace);
          font-size: 0.76rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--ink);
        }

        .top-bar-right {
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }

        .locations-header-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          font-family: var(--font-mono, monospace);
          font-size: 0.74rem;
          color: var(--ink);
          background: rgba(34, 211, 238, 0.08);
          border: 1px solid rgba(34, 211, 238, 0.25);
          border-radius: 999px;
          padding: 0.45rem 0.85rem;
          min-height: 44px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .locations-header-pill:hover {
          background: rgba(34, 211, 238, 0.16);
          border-color: rgba(34, 211, 238, 0.45);
          transform: translateY(-1px);
        }

        .lang-toggle {
          font-family: var(--font-mono, monospace);
          font-size: 0.74rem;
          letter-spacing: 0.06em;
          color: var(--ink-dim);
          background: rgba(228, 228, 231, 0.05);
          border: 1px solid var(--line);
          border-radius: 999px;
          padding: 0.45rem 0.85rem;
          min-height: 44px;
          min-width: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .lang-toggle:hover {
          color: var(--signal);
          border-color: rgba(34, 211, 238, 0.35);
          background: rgba(34, 211, 238, 0.08);
        }

        .content {
          position: relative;
          z-index: 10;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          max-width: 64rem;
          width: 100%;
          opacity: 0;
          transform: translateY(12px);
          transition: opacity 0.7s ease, transform 0.7s ease;
        }

        .content-in {
          opacity: 1;
          transform: translateY(0);
        }

        .eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          font-family: var(--font-mono, monospace);
          font-size: 0.72rem;
          letter-spacing: 0.05em;
          color: var(--ink-dim);
          border: 1px solid var(--line);
          background: rgba(228, 228, 231, 0.03);
          padding: 0.4rem 0.85rem;
          border-radius: 999px;
          margin-bottom: 1.5rem;
        }

        .page[data-lang="fa"] .eyebrow {
          font-family: var(--font-fa, "Vazirmatn", sans-serif);
          letter-spacing: 0;
        }

        .eyebrow-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: var(--signal);
          box-shadow: 0 0 8px 1px var(--signal);
          flex-shrink: 0;
        }

        .title {
          font-family: var(--font-mono, monospace);
          font-weight: 800;
          font-size: clamp(2.4rem, 7.5vw, 4.4rem);
          letter-spacing: 0.02em;
          line-height: 1.05;
          margin: 0 0 1rem;
          color: var(--ink);
          text-shadow: 0 0 36px rgba(34, 211, 238, 0.2);
        }

        .tagline {
          font-size: clamp(0.95rem, 2.2vw, 1.15rem);
          color: var(--ink-dim);
          max-width: 36rem;
          line-height: 1.65;
          margin: 0 0 1.75rem;
          padding: 0 0.5rem;
        }

        .page[data-lang="fa"] .tagline {
          font-size: clamp(1rem, 2.2vw, 1.2rem);
        }

        .locations-hero-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          padding: 1rem 1.5rem;
          background: rgba(18, 18, 24, 0.7);
          border: 1px solid rgba(34, 211, 238, 0.2);
          border-radius: 1.25rem;
          backdrop-filter: blur(14px);
          margin-bottom: 1.75rem;
          width: 100%;
          max-width: 30rem;
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
        }

        @media (min-width: 640px) {
          .locations-hero-card {
            flex-direction: row;
            justify-content: space-between;
            max-width: 36rem;
            padding: 1rem 2rem;
          }
        }

        .locations-meta {
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }

        .locations-stat-box {
          display: flex;
          flex-direction: column;
          text-align: start;
        }

        [dir="rtl"] .locations-stat-box {
          text-align: start;
        }

        .locations-number {
          font-family: var(--font-mono, monospace);
          font-size: 1.65rem;
          font-weight: 800;
          color: var(--signal);
          line-height: 1.1;
        }

        .locations-label {
          font-size: 0.76rem;
          color: var(--ink-dim);
          font-weight: 500;
        }

        .locations-divider {
          width: 1px;
          height: 2.2rem;
          background: var(--line);
        }

        .locations-cta-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          background: rgba(34, 211, 238, 0.12);
          border: 1px solid rgba(34, 211, 238, 0.35);
          color: var(--signal);
          padding: 0.55rem 1rem;
          border-radius: 0.75rem;
          font-size: 0.78rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          min-height: 44px;
        }

        .locations-cta-btn:hover {
          background: rgba(34, 211, 238, 0.2);
          border-color: rgba(34, 211, 238, 0.55);
          transform: translateY(-1px);
        }

        .cta-arrow {
          font-size: 0.9rem;
          transition: transform 0.2s ease;
        }

        .locations-cta-btn:hover .cta-arrow {
          transform: translateX(3px);
        }

        [dir="rtl"] .locations-cta-btn:hover .cta-arrow {
          transform: translateX(-3px);
        }

        .ticker {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          font-family: var(--font-mono, monospace);
          font-size: 0.72rem;
          color: var(--ink-dim);
          min-height: 4.5rem;
          justify-content: flex-end;
          margin-bottom: 2rem;
        }

        .page[data-lang="fa"] .ticker {
          font-family: var(--font-fa, "Vazirmatn", sans-serif);
          font-size: 0.8rem;
        }

        .ticker-line {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          justify-content: center;
          transition: opacity 0.3s ease;
        }

        .ticker-dot {
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: var(--signal-dim);
          flex-shrink: 0;
        }

        .downloads-section {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1.25rem;
          width: 100%;
          max-width: 32rem;
          margin-bottom: 3.5rem;
        }

        @media (min-width: 768px) {
          .downloads-section {
            grid-template-columns: repeat(3, 1fr);
            max-width: 60rem;
          }
        }

        .card {
          position: relative;
          text-align: start;
          border-radius: 1.25rem;
          border: 1px solid var(--line);
          background: rgba(18, 18, 22, 0.65);
          backdrop-filter: blur(14px);
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.2rem;
          transition: all 0.25s ease;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }

        .card:hover {
          transform: translateY(-3px);
          border-color: rgba(34, 211, 238, 0.35);
          background: rgba(22, 22, 28, 0.8);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        }

        .card-primary {
          border-color: rgba(34, 211, 238, 0.28);
          background: rgba(18, 24, 30, 0.7);
        }

        .card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: var(--signal);
        }

        .version-pill {
          font-family: var(--font-mono, monospace);
          font-size: 0.68rem;
          font-weight: 600;
          color: var(--signal);
          background: rgba(34, 211, 238, 0.1);
          border: 1px solid rgba(34, 211, 238, 0.25);
          padding: 0.15rem 0.5rem;
          border-radius: 999px;
        }

        .platform-tag {
          font-family: var(--font-mono, monospace);
          font-size: 0.68rem;
          color: var(--ink-dim);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .card-body h2 {
          font-size: 1.25rem;
          font-weight: 700;
          margin: 0 0 0.3rem;
          color: var(--ink);
        }

        .card-body p {
          font-size: 0.82rem;
          color: var(--ink-dim);
          margin: 0;
          line-height: 1.4;
        }

        .card-cta-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          font-family: var(--font-mono, monospace);
          font-size: 0.78rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--void);
          background: var(--signal);
          padding: 0.75rem 1rem;
          border-radius: 0.75rem;
          text-decoration: none;
          min-height: 44px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .card-cta-btn:hover {
          background: #38bdf8;
          box-shadow: 0 0 20px rgba(34, 211, 238, 0.4);
        }

        .page[data-lang="fa"] .card-cta-btn {
          font-family: var(--font-fa, "Vazirmatn", sans-serif);
          text-transform: none;
          letter-spacing: 0;
        }

        .multi-links-grid {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          margin-top: auto;
        }

        .multi-link {
          min-height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono, monospace);
          font-size: 0.74rem;
          font-weight: 600;
          color: var(--ink);
          background: rgba(228, 228, 231, 0.05);
          border: 1px solid var(--line);
          padding: 0.6rem 0.8rem;
          border-radius: 0.65rem;
          text-decoration: none;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .multi-link:hover {
          background: rgba(34, 211, 238, 0.12);
          border-color: rgba(34, 211, 238, 0.35);
          color: var(--signal);
        }

        .specs-section {
          width: 100%;
          max-width: 60rem;
          margin-bottom: 3.5rem;
          text-align: start;
        }

        .specs-title {
          font-size: 1.15rem;
          font-weight: 700;
          color: var(--ink);
          margin-bottom: 1.25rem;
          text-align: center;
          letter-spacing: 0.02em;
        }

        .specs-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        @media (min-width: 640px) {
          .specs-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        .spec-item {
          display: flex;
          align-items: flex-start;
          gap: 1rem;
          padding: 1.2rem;
          border-radius: 1rem;
          background: rgba(18, 18, 24, 0.5);
          border: 1px solid var(--line);
        }

        .spec-icon-box {
          font-size: 1.25rem;
          line-height: 1;
          padding: 0.5rem;
          border-radius: 0.6rem;
          background: rgba(34, 211, 238, 0.08);
          border: 1px solid rgba(34, 211, 238, 0.2);
          flex-shrink: 0;
        }

        .spec-content h3 {
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--ink);
          margin: 0 0 0.3rem;
        }

        .spec-content p {
          font-size: 0.8rem;
          color: var(--ink-dim);
          line-height: 1.5;
          margin: 0;
        }

        .page-footer {
          width: 100%;
          max-width: 40rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.8rem;
        }

        .footnote-text {
          font-size: 0.76rem;
          color: rgba(161, 161, 170, 0.7);
          line-height: 1.5;
          margin: 0;
        }

        .footer-links {
          display: flex;
          align-items: center;
          gap: 1rem;
          font-family: var(--font-mono, monospace);
          font-size: 0.72rem;
        }

        .footer-link {
          color: var(--ink-dim);
          text-decoration: none;
          transition: color 0.2s ease;
          padding: 0.3rem 0.5rem;
        }

        .footer-link:hover {
          color: var(--signal);
        }

        /* Modal / Drawer for Locations */
        .modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 50;
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          animation: fade-in 0.2s ease;
        }

        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .modal-dialog {
          background: #0d0d12;
          border: 1px solid rgba(34, 211, 238, 0.3);
          border-radius: 1.25rem;
          width: 100%;
          max-width: 42rem;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
          overflow: hidden;
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid var(--line);
        }

        .modal-title {
          font-size: 1.15rem;
          font-weight: 700;
          color: var(--ink);
          margin: 0;
        }

        .modal-subtitle {
          font-size: 0.78rem;
          color: var(--ink-dim);
          margin: 0.2rem 0 0;
        }

        .modal-close-btn {
          width: 38px;
          height: 38px;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: rgba(255, 255, 255, 0.05);
          color: var(--ink-dim);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.9rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .modal-close-btn:hover {
          color: var(--ink);
          background: rgba(255, 255, 255, 0.1);
        }

        .modal-search-wrap {
          padding: 1rem 1.5rem 0.5rem;
        }

        .modal-search-input {
          width: 100%;
          padding: 0.75rem 1rem;
          background: rgba(228, 228, 231, 0.04);
          border: 1px solid var(--line);
          border-radius: 0.75rem;
          color: var(--ink);
          font-size: 0.85rem;
          outline: none;
          transition: border-color 0.2s ease;
        }

        .modal-search-input:focus {
          border-color: var(--signal);
        }

        .modal-countries-list {
          padding: 1rem 1.5rem;
          overflow-y: auto;
          display: grid;
          grid-template-columns: 1fr;
          gap: 0.6rem;
          max-height: 52vh;
        }

        @media (min-width: 600px) {
          .modal-countries-list {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        .country-card {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.65rem 0.9rem;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 0.75rem;
        }

        .country-flag {
          font-size: 1.35rem;
          line-height: 1;
        }

        .country-info {
          display: flex;
          flex-direction: column;
          min-width: 0;
          flex: 1;
          text-align: start;
        }

        .country-name {
          font-size: 0.82rem;
          font-weight: 600;
          color: var(--ink);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .country-code {
          font-family: var(--font-mono, monospace);
          font-size: 0.68rem;
          color: var(--ink-dim);
        }

        .country-badge {
          font-family: var(--font-mono, monospace);
          font-size: 0.68rem;
          color: var(--signal);
          background: rgba(34, 211, 238, 0.1);
          border: 1px solid rgba(34, 211, 238, 0.2);
          padding: 0.15rem 0.5rem;
          border-radius: 999px;
          white-space: nowrap;
        }

        .modal-empty-state {
          grid-column: 1 / -1;
          padding: 2.5rem 1rem;
          text-align: center;
          color: var(--ink-dim);
          font-size: 0.85rem;
        }

        .modal-footer {
          padding: 0.9rem 1.5rem;
          border-top: 1px solid var(--line);
          display: flex;
          justify-content: flex-end;
          background: rgba(0, 0, 0, 0.25);
        }

        .modal-dismiss-btn {
          min-height: 44px;
          padding: 0.5rem 1.25rem;
          background: rgba(228, 228, 231, 0.08);
          border: 1px solid var(--line);
          border-radius: 0.65rem;
          color: var(--ink);
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .modal-dismiss-btn:hover {
          background: rgba(228, 228, 231, 0.15);
        }

        @media (max-width: 767px) {
          .tunnel-canvas {
            display: none !important;
          }
          .locations-hero-card,
          .card,
          .brand-badge,
          .modal-dialog {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            background: rgba(18, 18, 24, 0.96) !important;
          }
          .top-bar {
            top: 0.75rem;
            inset-inline: 0.75rem;
          }
          .brand-badge {
            padding: 0.35rem 0.65rem;
          }
          .brand-text {
            font-size: 0.7rem;
          }
          .title {
            font-size: clamp(1.85rem, 6.5vw, 2.75rem);
            margin-bottom: 0.75rem;
          }
          .tagline {
            font-size: 0.9rem;
            margin-bottom: 1.25rem;
            padding: 0;
          }
          .downloads-section {
            padding: 0 0.5rem;
            gap: 1rem;
            margin-bottom: 2rem;
          }
          .card {
            padding: 1.15rem;
          }
        }
      `}</style>
    </main>
  );
}

function OsIconWindows() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" />
      <rect x="13" y="3" width="8" height="8" />
      <rect x="3" y="13" width="8" height="8" />
      <rect x="13" y="13" width="8" height="8" />
    </svg>
  );
}

function OsIconLinux() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 10c0-2 1.5-4 4-4s4 2 4 4" />
      <path d="M7 16c1.5 1.5 3 2 5 2s3.5-.5 5-2" />
    </svg>
  );
}

function OsIconAndroid() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 16v-6a7 7 0 0 1 14 0v6" />
      <path d="M6 9l-2-3" />
      <path d="M18 9l2-3" />
      <circle cx="9" cy="11.5" r="1" fill="currentColor" />
      <circle cx="15" cy="11.5" r="1" fill="currentColor" />
    </svg>
  );
}
