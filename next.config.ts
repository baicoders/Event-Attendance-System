import type { NextConfig } from "next";
import { prepareQrDecoder } from "./scripts/prepare-qr-decoder.mjs";

// Ship the scanner's matching decoder with the site, including LAN-only installs.
prepareQrDecoder();

const nextConfig: NextConfig = {
  distDir: process.env.USWAG_TEST_DIST_DIR || ".next",
  typescript: {tsconfigPath: process.env.USWAG_TEST_TSCONFIG || "tsconfig.json"},
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Note: a full Content-Security-Policy is intentionally not set -
          // Next.js inline runtime scripts require nonce plumbing to do it
          // right. Revisit if the app ever handles untrusted HTML.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
