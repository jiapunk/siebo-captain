import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/**
 * SQLite 路徑工具（seed / reset / rebaseline / Playwright globalSetup 共用）
 *
 * Prisma 對 `file:./x.db` 這類相對路徑，是相對「schema.prisma 所在目錄」（prisma/）解析，
 * 不是相對 cwd；這裡用同一個規則，才能正確判斷 DATABASE_URL 是否指向 demo 用的 prisma/dev.db。
 */
export const PRISMA_DIR =
  typeof __dirname !== "undefined" ? __dirname : resolve(process.cwd(), "prisma");

/** demo 現場資料庫（只有 db:rebaseline 與明確帶 --allow-dev-db 的腳本可以動它） */
export const DEV_DB_PATH = join(PRISMA_DIR, "dev.db");

export const DEFAULT_DATABASE_URL = "file:./dev.db";

/** 目前生效的 DATABASE_URL（未設定時退回 file:./dev.db，與 prisma.config.ts 一致） */
export function databaseUrl(): string {
  return process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
}

/** 把 `file:` URL 轉成絕對檔案路徑；非 SQLite URL 回 null */
export function sqlitePathFromUrl(url: string): string | null {
  if (!url.startsWith("file:")) return null;
  let p = url.slice("file:".length).split("?")[0];
  if (p.startsWith("//")) p = p.slice(2); // file:///abs/path
  if (!p) return null;
  return isAbsolute(p) ? p : resolve(PRISMA_DIR, p);
}

/**
 * 把相對的 SQLite URL 轉成絕對路徑 URL（保留 ?query），非 file: URL 原樣回傳。
 * 腳本用這個建立 PrismaClient，確保實際開啟的檔案就是防呆檢查過的那一個
 * （不受 node_modules 是 symlink、或 generated client 位置影響）。
 */
export function absoluteDatabaseUrl(url: string = databaseUrl()): string {
  const p = sqlitePathFromUrl(url);
  if (!p) return url;
  const q = url.indexOf("?");
  return `file:${p}${q >= 0 ? url.slice(q) : ""}`;
}

function canonical(path: string): string {
  try {
    return existsSync(path) ? realpathSync(path) : resolve(path);
  } catch {
    return resolve(path);
  }
}

/** 這個 URL 是否解析到 prisma/dev.db */
export function isDevDbUrl(url: string): boolean {
  const p = sqlitePathFromUrl(url);
  return p !== null && canonical(p) === canonical(DEV_DB_PATH);
}
