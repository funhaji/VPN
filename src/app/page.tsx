"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";

const WINDOWS_URL =
  "https://github.com/funhaji/AstroVPN/raw/main/Astro%20VPN_setup.exe";
const DEB_URL = "https://github.com/funhaji/AstroVPN/raw/main/linux/AstroVPN.deb";
const RPM_URL = "https://github.com/funhaji/AstroVPN/raw/main/linux/AstroVPN.rpm";
const APPIMAGE_URL =
  "https://github.com/funhaji/AstroVPN/releases/download/Main/AstroVPN.AppImage";
const ANDROID_URL =
  "https://github.com/funhaji/AstroVPN/releases/download/Android/app-universal-release.apk";

type Lang = "en" | "fa";

const COPY: Record<
  Lang,
  {
    status: string;
    tagline: string;
    ticker: string[];
    winSub: string;
    winCta: string;
    linuxTitle: string;
    linuxSub: string;
    androidTitle: string;
    androidSub: string;
    footnote: string;
  }
> = {
  en: {
    status: "no logs kept, checked weekly",
    tagline: "Your traffic, folded into noise nobody can sort back out.",
    ticker: [
      "key exchange settled",
      "cipher chacha20-poly1305",
      "route obfuscated",
      "packet shape randomized",
      "leak probe returned clean",
      "latency within range",
    ],
    winSub: "10 / 11, 64-bit",
    winCta: "Download .exe",
    linuxTitle: "Linux",
    linuxSub: "Debian, Ubuntu, Fedora, Arch",
    androidTitle: "Android",
    androidSub: "Universal APK",
    footnote: "keys are generated on your device and never leave it",
  },
  fa: {
    status: "بدون ثبت لاگ، هفتگی بررسی می‌شود",
    tagline: "ترافیک شما، لابه‌لای نویزی که هیچ‌کس نمی‌تواند بازش کند.",
    ticker: [
      "تبادل کلید انجام شد",
      "رمزنگاری chacha20-poly1305",
      "مسیر مبهم‌سازی شد",
      "شکل بسته‌ها تصادفی شد",
      "بررسی نشت، تمیز بود",
      "تاخیر در محدوده عادی",
    ],
    winSub: "ویندوز ۱۰ و ۱۱، ۶۴ بیتی",
    winCta: "دریافت نسخه ویندوز",
    linuxTitle: "لینوکس",
    linuxSub: "دبیان، اوبونتو، فدورا، آرچ",
    androidTitle: "اندروید",
    androidSub: "Universal APK",
    footnote: "کلیدها روی دستگاه شما ساخته می‌شوند و هرگز خارج نمی‌شوند",
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

    const rings = 26;
    const pulses = Array.from({ length: 5 }, (_, i) => ({
      offset: i / 5,
      speed: 0.00028 + i * 0.00003,
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
      const cy = height * 0.4;
      const maxR = Math.hypot(width, height) * 0.62;

      for (let i = 0; i < rings; i++) {
        const rp = i / rings;
        const wobble = prefersReduced ? 0 : Math.sin(t * 0.0006 + i * 0.6) * 3;
        const r = 40 + rp * maxR + wobble;
        const alpha = (1 - rp) * 0.13;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.6, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(34, 211, 238, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (!prefersReduced) {
        pulses.forEach((p) => {
          const progress = (t * p.speed + p.offset) % 1;
          const r = 40 + progress * maxR;
          const alpha = Math.sin(progress * Math.PI) * 0.9;
          ctx.beginPath();
          ctx.ellipse(cx, cy, r, r * 0.6, 0, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(99, 102, 241, ${alpha * 0.5})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.beginPath();
          ctx.ellipse(cx, cy, r * 0.998, r * 0.6 * 0.998, 0, 0, Math.PI * 2);
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
        return next.slice(-4);
      });
    }, 1500);
    return () => clearInterval(id);
  }, [messages]);

  return (
    <div className="ticker" aria-hidden="true">
      {lines.map((line, idx) => (
        <div
          key={idx}
          className="ticker-line"
          style={{ opacity: 0.3 + (idx / lines.length) * 0.7 }}
        >
          <span className="ticker-dot" />
          {line}
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

  useEffect(() => {
    setLang(detectLang());
    setMounted(true);
  }, []);

  const toggleLang = useCallback(() => {
    setLang((prev) => {
      const next = prev === "en" ? "fa" : "en";
      window.localStorage.setItem("astro-lang", next);
      return next;
    });
  }, []);

  const downloadFile = (url: string) => {
    const a = document.createElement('a');
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const c = COPY[lang];
  const title = useScramble("ASTROVPN", 150);
  const isRtl = lang === "fa";

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

      <button
        type="button"
        onClick={toggleLang}
        className="lang-toggle"
        aria-label={isRtl ? "Switch to English" : "تغییر به فارسی"}
      >
        {isRtl ? "EN" : "فا"}
      </button>

      <div className={`content ${mounted ? "content-in" : ""}`}>
        <div className="eyebrow">
          <span className="eyebrow-dot" />
          {c.status}
        </div>

        <h1 className="title" dir="ltr">
          {title}
        </h1>

        <p className="tagline">{c.tagline}</p>

        <StatusTicker lines={c.ticker} />

        <div className="downloads">
          <button onClick={() => downloadFile(WINDOWS_URL)} className="card card-primary" style={{cursor: 'pointer'}}>
            <div className="card-top">
              <OsIconWindows />
              <span className="card-arrow">{isRtl ? "←" : "→"}</span>
            </div>
            <div className="card-body">
              <h2>Windows</h2>
              <p>{c.winSub}</p>
            </div>
            <div className="card-cta">{c.winCta}</div>
          </button>

          <div className="card card-secondary">
            <div className="card-top">
              <OsIconLinux />
            </div>
            <div className="card-body">
              <h2>{c.linuxTitle}</h2>
              <p>{c.linuxSub}</p>
            </div>
            <div className="linux-links">
              <button onClick={() => downloadFile(DEB_URL)} className="linux-link" style={{cursor: 'pointer'}}>
                .deb
              </button>
              <button onClick={() => downloadFile(RPM_URL)} className="linux-link" style={{cursor: 'pointer'}}>
                .rpm
              </button>
              <button onClick={() => downloadFile(APPIMAGE_URL)} className="linux-link" style={{cursor: 'pointer'}}>
                AppImage
              </button>
            </div>
          </div>

          <div className="card card-secondary">
            <div className="card-top">
              <OsIconAndroid />
            </div>
            <div className="card-body">
              <h2>{c.androidTitle}</h2>
              <p>{c.androidSub}</p>
            </div>
            <div className="linux-links">
              <button onClick={() => downloadFile(ANDROID_URL)} className="linux-link" style={{cursor: 'pointer'}}>
                .apk
              </button>
            </div>
          </div>
        </div>

        <div className="footnote">{c.footnote}</div>
      </div>

      <style>{`
        .page {
          position: relative;
          min-height: 100vh;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 6rem 1.5rem 3rem;
          overflow: hidden;
          background: var(--void);
          isolation: isolate;
        }

        .page[data-lang="fa"] .content {
          font-family: var(--font-fa, "Vazirmatn", var(--font-geist-sans), sans-serif);
        }

        .tunnel-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: 0;
        }

        .vignette {
          position: absolute;
          inset: 0;
          z-index: 1;
          background:
            radial-gradient(ellipse 80% 60% at 50% 40%, transparent 0%, var(--void) 78%),
            linear-gradient(180deg, var(--void-deep) 0%, transparent 18%, transparent 78%, var(--void-deep) 100%);
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

        .lang-toggle {
          position: absolute;
          top: 1.5rem;
          inset-inline-end: 1.5rem;
          z-index: 4;
          font-family: var(--font-mono, monospace);
          font-size: 0.72rem;
          letter-spacing: 0.06em;
          color: var(--ink-dim);
          background: rgba(228, 228, 231, 0.04);
          border: 1px solid var(--line);
          border-radius: 999px;
          padding: 0.4rem 0.85rem;
          cursor: pointer;
          transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease;
        }

        .lang-toggle:hover {
          color: var(--signal);
          border-color: rgba(34, 211, 238, 0.35);
          background: rgba(34, 211, 238, 0.06);
        }

        .content {
          position: relative;
          z-index: 3;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          max-width: 54rem;
          width: 100%;
          opacity: 0;
          transform: translateY(14px);
          transition: opacity 0.8s ease, transform 0.8s ease;
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
          letter-spacing: 0.06em;
          color: var(--ink-dim);
          border: 1px solid var(--line);
          background: rgba(228, 228, 231, 0.03);
          padding: 0.4rem 0.85rem;
          border-radius: 999px;
          margin-bottom: 2rem;
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
          animation: pulse-dot 2.4s ease-in-out infinite;
          flex-shrink: 0;
        }

        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(0.75); }
        }

        .title {
          font-family: var(--font-mono, monospace);
          font-weight: 700;
          font-size: clamp(2.6rem, 8vw, 4.5rem);
          letter-spacing: 0.02em;
          line-height: 1;
          margin: 0 0 1.25rem;
          color: var(--ink);
          text-shadow: 0 0 40px rgba(34, 211, 238, 0.18);
        }

        .tagline {
          font-size: clamp(1rem, 2.4vw, 1.15rem);
          color: var(--ink-dim);
          max-width: 30rem;
          line-height: 1.7;
          margin: 0 0 2.25rem;
        }

        .page[data-lang="fa"] .tagline {
          font-size: clamp(1.05rem, 2.4vw, 1.2rem);
        }

        .ticker {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          font-family: var(--font-mono, monospace);
          font-size: 0.7rem;
          color: var(--ink-dim);
          height: 5.5rem;
          justify-content: flex-end;
          margin-bottom: 2.75rem;
          min-width: 14rem;
        }

        .page[data-lang="fa"] .ticker {
          font-family: var(--font-fa, "Vazirmatn", sans-serif);
          font-size: 0.78rem;
        }

        .ticker-line {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          justify-content: center;
          transition: opacity 0.4s ease;
        }

        .ticker-dot {
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: var(--signal-dim);
          flex-shrink: 0;
        }

        .downloads {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1rem;
          width: 100%;
          max-width: 30rem;
        }

        @media (min-width: 768px) {
          .downloads {
            grid-template-columns: repeat(3, 1fr);
            max-width: 52rem;
          }
        }

        .card {
          position: relative;
          text-align: start;
          border-radius: 1rem;
          border: 1px solid var(--line);
          background: rgba(228, 228, 231, 0.02);
          backdrop-filter: blur(10px);
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          transition: border-color 0.3s ease, background 0.3s ease, transform 0.3s ease;
          text-decoration: none;
          color: inherit;
        }

        .card:hover {
          transform: translateY(-3px);
          border-color: rgba(34, 211, 238, 0.35);
          background: rgba(34, 211, 238, 0.045);
        }

        .card-primary {
          box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.08) inset;
        }

        .card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: var(--ink-dim);
        }

        .card-primary .card-top {
          color: var(--signal);
        }

        .card-arrow {
          font-size: 1rem;
          opacity: 0.6;
          transition: transform 0.3s ease, opacity 0.3s ease;
        }

        .card:hover .card-arrow {
          transform: translateX(4px);
          opacity: 1;
        }

        [dir="rtl"] .card:hover .card-arrow {
          transform: translateX(-4px);
        }

        .card-body h2 {
          font-size: 1.1rem;
          font-weight: 600;
          margin: 0 0 0.2rem;
        }

        .card-body p {
          font-size: 0.82rem;
          color: var(--ink-dim);
          margin: 0;
          font-family: var(--font-mono, monospace);
        }

        .page[data-lang="fa"] .card-body p {
          font-family: var(--font-fa, "Vazirmatn", sans-serif);
          font-size: 0.86rem;
        }

        .card-cta {
          font-family: var(--font-mono, monospace);
          font-size: 0.75rem;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--void);
          background: var(--signal);
          text-align: center;
          padding: 0.6rem;
          border-radius: 0.5rem;
          font-weight: 600;
        }

        .page[data-lang="fa"] .card-cta {
          font-family: var(--font-fa, "Vazirmatn", sans-serif);
          text-transform: none;
          letter-spacing: 0;
        }

        .linux-links {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .linux-link {
          flex: 1;
          min-width: 4.5rem;
          text-align: center;
          font-family: var(--font-mono, monospace);
          font-size: 0.72rem;
          letter-spacing: 0.03em;
          color: var(--ink);
          background: rgba(228, 228, 231, 0.05);
          border: 1px solid var(--line);
          padding: 0.55rem 0.4rem;
          border-radius: 0.5rem;
          text-decoration: none;
          transition: background 0.2s ease, border-color 0.2s ease;
        }

        .linux-link:hover {
          background: rgba(34, 211, 238, 0.1);
          border-color: rgba(34, 211, 238, 0.3);
          color: var(--signal);
        }

        .footnote {
          margin-top: 2.5rem;
          font-family: var(--font-mono, monospace);
          font-size: 0.7rem;
          letter-spacing: 0.04em;
          color: rgba(113, 113, 122, 0.7);
        }

        .page[data-lang="fa"] .footnote {
          font-family: var(--font-fa, "Vazirmatn", sans-serif);
          letter-spacing: 0;
          font-size: 0.76rem;
        }
      `}</style>
    </main>
  );
}

function OsIconWindows() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" />
      <rect x="13" y="3" width="8" height="8" />
      <rect x="3" y="13" width="8" height="8" />
      <rect x="13" y="13" width="8" height="8" />
    </svg>
  );
}

function OsIconLinux() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 10c0-2 1.5-4 4-4s4 2 4 4" />
      <path d="M7 16c1.5 1.5 3 2 5 2s3.5-.5 5-2" />
    </svg>
  );
}

function OsIconAndroid() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 16v-6a7 7 0 0 1 14 0v6" />
      <path d="M6 9l-2-3" />
      <path d="M18 9l2-3" />
      <circle cx="9" cy="11.5" r="1" fill="currentColor" />
      <circle cx="15" cy="11.5" r="1" fill="currentColor" />
    </svg>
  );
}
