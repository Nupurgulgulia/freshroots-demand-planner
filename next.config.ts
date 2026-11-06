import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The end-to-end tests build into their own folder so they can run while `npm run dev` is up.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // PGlite (local dev database) ships WASM and must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Migrations are applied on first DB use, so ship them with every function.
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] },
  experimental: {
    // Local dev only: reusing the previous session's Turbopack cache after a restart left pages stuck in
    // a reload loop on this machine. Production builds are unaffected.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
