/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["puppeteer", "pdf-parse"],
  allowedDevOrigins: ["192.168.56.1", "10.214.102.101", "localhost", "127.0.0.1"],
  turbopack: {
    root: __dirname,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config, { isServer }) => {
    config.externals.push("pdf-parse");
    config.module.rules.push({
      test: /\.worker\.js$/,
      use: { loader: "worker-loader" },
    });
    config.module.rules.push({
      test: /\.node$/,
      use: "node-loader",
    });
    return config;
  },
};

module.exports = nextConfig;
