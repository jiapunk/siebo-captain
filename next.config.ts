import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

/**
 * next dev 只預設允許 localhost 與啟動時的 hostname；手機用區網 IP / QR 開頁面時，
 * /_next/hmr 等 dev 資源會被擋（頁面不 hydrate、反覆重新整理）。
 * 這裡自動加入本機所有區網 IPv4，另可用 ALLOWED_DEV_ORIGINS（逗號分隔 hostname）補充。
 * 格式依 docs：只寫 hostname，不含 scheme / port。只影響 dev，正式模式（next start）不受影響。
 */
function lanIPv4(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  return out;
}

const extraOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // 測試用獨立 distDir（NEXT_DIST_DIR=.next-test-<port>），避免與 dev server 的單實例鎖衝突
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: [...new Set([...extraOrigins, ...lanIPv4()])],
};

export default nextConfig;
