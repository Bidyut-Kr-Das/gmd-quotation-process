import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ['192.168.1.*', 'localhost', '127.0.0.1'],
  // `unpdf` bundles PDF.js and relies on Node-specific loading; keep it out of
  // the server bundle so the docket-creation route can `require` it natively.
  serverExternalPackages: ["unpdf"],
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  //  output: "standalone",
};

export default nextConfig;
