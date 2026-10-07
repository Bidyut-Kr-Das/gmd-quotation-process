import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["@gmd/db-quotation"],
  allowedDevOrigins: ['192.168.1.*', 'localhost', '127.0.0.1'],
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
   output: "standalone",
};

export default nextConfig;
