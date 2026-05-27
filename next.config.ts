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
};

export default nextConfig;
