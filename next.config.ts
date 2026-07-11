import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {},
  outputFileTracingExcludes: {
    "/api/radio": [
      "./CLAUDE.md",
      "./LICENSE",
      "./Makefile",
      "./README.md",
      "./RESEARCH.md",
      "./app/**/*.test.ts",
      "./app/**/*.test.tsx",
      "./docs/**/*",
      "./lib/**/*.test.ts",
      "./next.config.*",
      "./public/outputs/**/*",
    ],
  },
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "host", value: "radio.pardev.net" }],
        destination: "/radio",
        permanent: false,
      },
    ];
  },
  // Security headers applied to every response (SEC-005). The CSP is strict but
  // allows the inline scripts/styles Next.js App Router injects for hydration
  // and route prefetching (a nonce-based policy would require rewiring
  // middleware; this is the pragmatic, no-rebuild baseline). The app loads no
  // third-party scripts: default-src/connect-src are locked to 'self', so even
  // an injected inline script cannot exfiltrate data to an attacker origin.
  // `frame-ancestors 'none'` (+ X-Frame-Options: DENY) stops clickjacking;
  // object-src 'none' / base-uri 'self' block plugin and <base> hijacks.
  async headers() {
    // React dev mode requires eval() for stack-frame reconstruction (it never
    // uses eval in production). Allow 'unsafe-eval' only in development so the
    // production CSP stays strict.
    const isDev = process.env.NODE_ENV !== "production";
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    const contentSecurityPolicy = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "media-src 'self' data: blob:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
