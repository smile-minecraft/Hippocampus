import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb",
    },
    // The error says: See https://nextjs.org/.../middlewareClientMaxBodySize
    // Add to override 10MB limit for NextRequest
    proxyClientMaxBodySize: 200 * 1024 * 1024,
  },
};

export default nextConfig;
