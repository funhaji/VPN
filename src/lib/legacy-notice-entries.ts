const english = [
  "Update Astro VPN to continue", "This app version is no longer supported",
  "Install the latest Astro VPN", "New servers require the latest app",
  "Open the update screen", "Your server list needs an app update",
  "Get the latest version from the official website", "Update for improved connections",
  "These entries are update notices", "Update the app, then refresh servers",
];
const persian = [
  "برای ادامه، آسترو وی‌پی‌ان را به‌روزرسانی کنید", "این نسخه دیگر پشتیبانی نمی‌شود",
  "آخرین نسخه آسترو وی‌پی‌ان را نصب کنید", "سرورهای جدید به آخرین نسخه نیاز دارند",
  "صفحه به‌روزرسانی را باز کنید", "برای دریافت سرورها، برنامه را به‌روزرسانی کنید",
  "نسخه جدید را از وب‌سایت رسمی دریافت کنید", "برای اتصال بهتر، برنامه را به‌روزرسانی کنید",
  "این موارد پیام به‌روزرسانی هستند", "برنامه را به‌روزرسانی و سرورها را تازه‌سازی کنید",
];

export function legacyNoticeEntries() {
  return [...english, ...persian].map((name, index) => ({
    id: `update-required-${index + 1}`, name, protocol: "vless", country: "GLOBAL",
    host: null, port: null, rawConfig: "", notice: name,
    options: { mux: false, fragment: false, sniffing: false, allowInsecure: false, extra: {} },
    runtimeProfile: { engine: "unsupported", supported: false, reason: name },
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
}
