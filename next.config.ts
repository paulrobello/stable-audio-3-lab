import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {},
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
