import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@gmd/db-stock", "@gmd/ui", "@gmd/dashboard", "@gmd/physical-stock"],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  allowedDevOrigins: ["192.168.1.127", "192.168.1.200", "192.168.1.123", "192.168.1.190"],
};

export default nextConfig;
