// What the payment log records about the device a payment was taken on:
// how Godview was opened (Android app, installed web app or browser), the
// platform, screen, language and time zone. The database adds the IP address
// and browser from the request itself.
export function deviceInfo() {
  try {
    const nav = navigator;
    const native = Boolean(window.Capacitor?.isNativePlatform?.());
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
    return {
      app: native ? `${window.Capacitor.getPlatform?.() ?? "native"} app` : standalone ? "installed web app" : "browser",
      platform: nav.userAgentData?.platform || nav.platform || null,
      mobile: nav.userAgentData?.mobile ?? /Mobi|Android|iPhone/i.test(nav.userAgent),
      screen: `${screen.width}x${screen.height}`,
      window: `${window.innerWidth}x${window.innerHeight}`,
      pixel_ratio: window.devicePixelRatio || 1,
      language: nav.language || null,
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      local_time: new Date().toString().slice(0, 33),
      online: nav.onLine,
      cores: nav.hardwareConcurrency || null,
      memory_gb: nav.deviceMemory || null,
    };
  } catch {
    return null;
  }
}

// "Chrome on Android" from a browser's user agent.
export function deviceName(ua = "") {
  const browser = /EdgA?\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS/.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : /okhttp|Dart|curl|node/i.test(ua)
                ? "Script"
                : null;
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /iPad/.test(ua)
        ? "iPad"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  return [browser, os].filter(Boolean).join(" on ") || (ua ? "Other device" : "Unknown");
}
