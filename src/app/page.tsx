"use client";

import React, { useState } from 'react';

export default function DownloadPage() {
  const downloadFile = (url: string) => {
    const a = document.createElement('a');
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <main className="space-bg min-h-screen flex flex-col items-center justify-center p-6 text-white">
      <div className="absolute inset-0 bg-zinc-950/80 -z-10" />
      
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 shadow-xl shadow-cyan-500/30 mb-8">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-950">
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      </div>

      <h1 className="text-5xl font-bold tracking-tight mb-4 text-center">AstroVPN</h1>
      <p className="text-zinc-400 text-lg mb-12 text-center max-w-md">
        Fast, secure, and resilient internet access. Bypass DPI effortlessly.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl">
        {/* Windows */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-md flex flex-col items-center hover:bg-white/10 transition-colors">
          <div className="text-4xl mb-4">??</div>
          <h2 className="text-xl font-semibold mb-2">Windows</h2>
          <p className="text-zinc-500 text-sm mb-6 text-center">Windows 10 / 11 (64-bit)</p>
          <button 
            onClick={() => downloadFile("https://github.com/funhaji/AstroVPN/raw/main/Astro%20VPN_setup.exe")}
            className="w-full text-center rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 font-medium text-white shadow-lg shadow-blue-500/25 hover:from-blue-400 hover:to-blue-500 transition-all"
          >
            Download for Windows
          </button>
        </div>

        {/* Linux */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-md flex flex-col items-center hover:bg-white/10 transition-colors">
          <div className="text-4xl mb-4">??</div>
          <h2 className="text-xl font-semibold mb-2">Linux</h2>
          <p className="text-zinc-500 text-sm mb-6 text-center">Debian, Ubuntu, Fedora, Arch</p>
          <div className="flex flex-col gap-2 w-full">
            <button 
              onClick={() => downloadFile("https://github.com/funhaji/AstroVPN/raw/main/linux/AstroVPN.deb")}
              className="w-full text-center rounded-lg bg-white/10 px-4 py-2 font-medium text-white hover:bg-white/20 transition-all"
            >
              .DEB (Debian/Ubuntu)
            </button>
            <button 
              onClick={() => downloadFile("https://github.com/funhaji/AstroVPN/raw/main/linux/AstroVPN.rpm")}
              className="w-full text-center rounded-lg bg-white/10 px-4 py-2 font-medium text-white hover:bg-white/20 transition-all"
            >
              .RPM (Fedora/RHEL)
            </button>
            <button 
              onClick={() => downloadFile("https://github.com/funhaji/AstroVPN/releases/download/Main/AstroVPN.AppImage")}
              className="w-full text-center rounded-lg bg-white/10 px-4 py-2 font-medium text-white hover:bg-white/20 transition-all"
            >
              .AppImage (Portable)
            </button>
          </div>
        </div>
      </div>
      
      <div className="mt-16 text-zinc-600 text-sm flex gap-4">
        <a href="/admin" className="hover:text-zinc-400 transition-colors">Admin Panel</a>
        <span>&bull;</span>
        <a href="https://github.com/funhaji/AstroVPN" className="hover:text-zinc-400 transition-colors">GitHub Source</a>
      </div>
    </main>
  );
}
