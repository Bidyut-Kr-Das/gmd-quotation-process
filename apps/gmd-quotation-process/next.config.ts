import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["@gmd/db-quotation", "@gmd/db-tender", "@gmd/ui", "@gmd/dashboard", "@gmd/contract-review", "@gmd/physical-stock"],
  allowedDevOrigins: ['192.168.1.*', 'localhost', '127.0.0.1'],
  // `unpdf` bundles PDF.js and relies on Node-specific loading; keep it out of
  // the server bundle so the docket-creation route can `require` it natively.
  serverExternalPackages: ["unpdf"],
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
    // `proxy.ts` buffers every matched request body in memory (default 10MB).
    // Docket creation POSTs base64 attachments through the proxy, so raise the
    // proxy buffer to match the Server Action limit.
    proxyClientMaxBodySize: '100mb',
  },
   output: "standalone",
};

export default nextConfig;
