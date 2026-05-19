/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["puppeteer"],
  allowedDevOrigins: ["192.168.56.1", "10.214.102.101", "localhost", "127.0.0.1"],
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;
