import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR || ".next";
const isDevelopment = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  distDir,
  ...(isDevelopment
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: "http://localhost:8787/api/:path*",
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
