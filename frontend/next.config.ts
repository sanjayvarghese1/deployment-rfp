import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["puppeteer"],
  allowedDevOrigins: ["192.168.56.1", "10.214.102.101", "localhost", "127.0.0.1"],
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
