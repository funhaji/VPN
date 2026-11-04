import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Vazirmatn } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const vazirmatn = Vazirmatn({
  variable: "--font-fa",
  subsets: ["arabic"],
});

// Runs before hydration: apply the visitor's language/direction immediately so
// Persian users don't see an English, left-to-right flash.
const BOOT_LANG = `(function(){try{var l=localStorage.getItem("astro-lang");if(l!=="en"&&l!=="fa"){l=(navigator.language||"").toLowerCase().indexOf("fa")===0?"fa":"en"}if(l==="fa"){var h=document.documentElement;h.lang="fa";h.dir="rtl";h.setAttribute("data-boot-lang","fa");setTimeout(function(){h.removeAttribute("data-boot-lang")},4000)}}catch(e){}})();`;

export const metadata: Metadata = {
  title: "Astro VPN — Download for Android, Windows & Linux",
  description: "Fast, private VPN built for restricted networks. Download Astro VPN for Android, Windows and Linux.",
};

export const viewport: Viewport = {
  themeColor: "#0c0c0b",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${vazirmatn.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_LANG }} />
      </head>
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}
