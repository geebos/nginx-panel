import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR || ".next";
const isDevelopment = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
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
            {
              source: "/domains/:id/:path+",
              destination: "/domains/detail",
            },
            {
              source: "/deployments/:id",
              destination: "/deployments/detail",
            },
            {
              source: "/settings/:tab",
              destination: "/settings",
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
