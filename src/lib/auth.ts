import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { prisma } from "./db";

const SCRYPT_KEYLEN = 64;

/** scrypt 密碼雜湊（格式：salt:hash，皆為 hex） */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export const SID_COOKIE = "sc_sid";
const SESSION_DAYS = 30;

/** 建立登入工作階段，回傳 cookie 用的 token */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  // 只存 token 的雜湊，資料庫外洩時無法直接冒用
  const id = createHash("sha256").update(token).digest("hex");
  await prisma.session.create({
    data: {
      id,
      userId,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

export async function resolveSessionUserId(
  token: string,
): Promise<string | null> {
  const id = createHash("sha256").update(token).digest("hex");
  const s = await prisma.session.findUnique({ where: { id } });
  if (!s) return null;
  if (s.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id } }).catch(() => {});
    return null;
  }
  return s.userId;
}

export async function destroySession(token: string): Promise<void> {
  const id = createHash("sha256").update(token).digest("hex");
  await prisma.session.delete({ where: { id } }).catch(() => {});
}

// ================= Email 驗證 / 密碼重設 權杖 =================
export type AuthTokenKind = "verify" | "reset";

/** 建立一次性權杖（資料庫只存雜湊），回傳原始 token */
export async function createAuthToken(
  userId: string,
  kind: AuthTokenKind,
  ttlMinutes: number,
): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const id = createHash("sha256").update(raw).digest("hex");
  await prisma.authToken.create({
    data: {
      id,
      userId,
      kind,
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
    },
  });
  return raw;
}

/** 驗證並消耗權杖；失敗回傳 null */
export async function consumeAuthToken(
  rawToken: string,
  kind: AuthTokenKind,
): Promise<string | null> {
  const id = createHash("sha256").update(rawToken).digest("hex");
  const t = await prisma.authToken.findUnique({ where: { id } });
  if (!t || t.kind !== kind || t.usedAt) return null;
  if (t.expiresAt.getTime() < Date.now()) return null;
  await prisma.authToken.update({ where: { id }, data: { usedAt: new Date() } });
  return t.userId;
}

/** 是否允許回傳 dev 驗證/重設連結（demo 用；production 預設關閉） */
export function devAuthLinksEnabled(): boolean {
  if (process.env.AUTH_DEV_LINKS === "off") return false;
  if (process.env.AUTH_DEV_LINKS === "on") return true;
  return process.env.NODE_ENV !== "production";
}

/** 密碼規則：8-72 字元、不可等於 Email */
export function validatePassword(password: string, email: string): string | null {
  if (password.length < 8) return "weak_password";
  if (password.length > 72) return "weak_password";
  if (password.trim().toLowerCase() === email.trim().toLowerCase())
    return "weak_password";
  return null;
}
