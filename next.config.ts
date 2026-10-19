import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Supabase-mode e2e build uses its own output dir so it never clobbers the normal .next build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
