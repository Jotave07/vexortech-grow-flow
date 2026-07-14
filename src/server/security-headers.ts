const exactOrigin = (value?: string | null) => {
  if (!value?.trim()) return "";
  try {
    const url = new URL(value);
    const production =
      process.env.NODE_ENV === "production" || Boolean(process.env.DENO_DEPLOYMENT_ID);
    if (url.protocol === "https:") return url.origin;
    if (
      !production &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) {
      return url.origin;
    }
  } catch {
    // Invalid URLs are not admitted to the browser policy.
  }
  return "";
};

export const buildConnectSources = (supabaseUrl?: string | null) => {
  const origin = exactOrigin(supabaseUrl);
  if (!origin) return ["'self'"];
  const url = new URL(origin);
  const socketOrigin = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
  return ["'self'", origin, socketOrigin];
};

export const createSecurityHeaders = (): Record<string, string> => {
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;
  const connectSources = buildConnectSources(supabaseUrl).join(" ");

  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      `connect-src ${connectSources}`,
      "frame-src 'none'",
      "worker-src 'self' blob:",
    ].join("; "),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(self), payment=(self)",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Permitted-Cross-Domain-Policies": "none",
  };
};
