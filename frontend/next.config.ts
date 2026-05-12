import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["puppeteer"],
  allowedDevOrigins: ["192.168.56.1", "10.214.102.101", "localhost", "127.0.0.1"],
  turbopack: {
    root: ".",
  },
};

export default nextConfig;
