import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 測試用獨立 distDir（NEXT_DIST_DIR=.next-test），避免與 dev server 的單實例鎖衝突
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
