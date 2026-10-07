import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "smartsheet",
  ],
  // output: "standalone",
  experimental: {
    authInterrupts: true,
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  allowedDevOrigins: ["192.168.1.200", "192.168.1.229"],
};   

export default nextConfig;
