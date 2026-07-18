import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR || '.next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  images: {
    unoptimized: true,
  },
  distDir,
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: "http://localhost:8787/api/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
