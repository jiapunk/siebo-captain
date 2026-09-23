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

// 假雜湊：帳號不存在（或沒有密碼）時也跑一次等價成本的 scrypt，消除「存在與否」的時間差
let dummyHash: string | null = null;

/**
 * 登入用：stored 為 null（帳號不存在或沒設密碼）時對假雜湊跑一次 scrypt 再回 false，
 * 讓存在/不存在的 email 回應時間一致，避免帳號列舉。
 */
export function verifyPasswordOrDummy(
  password: string,
  stored: string | null | undefined,
): boolean {
  if (stored) return verifyPassword(password, stored);
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  verifyPassword(password, dummyHash);
  return false;
}

export const SID_COOKIE = "sc_sid";
const SESSION_DAYS = 30;
export const SESSION_MAX_AGE_SEC = SESSION_DAYS * 24 * 60 * 60;

/**
 * 請求是否經由 HTTPS 進來：直接看 URL 的 protocol；
 * TRUST_PROXY=1（前面有自己的 TLS 反代）時也採信 X-Forwarded-Proto。
 */
export function isHttpsRequest(req: Request): boolean {
  try {
    if (new URL(req.url).protocol === "https:") return true;
  } catch {}
  if (process.env.TRUST_PROXY === "1") {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    return proto === "https";
  }
  return false;
}

/**
 * 身分 cookie（sc_sid / sd_uid）的統一設定：HttpOnly、SameSite=Lax、Path=/。
 * Secure：production 且請求走 HTTPS 時加上。
 * production 但走純 HTTP（例如 demo:serve 在會場區網 http://192.168.x.x）時刻意不加——
 * 瀏覽器會直接丟掉非 HTTPS 來源設定的 Secure cookie，登入會整個壞掉。
 */
export function authCookieOptions(req: Request, maxAgeSec = SESSION_MAX_AGE_SEC) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production" && isHttpsRequest(req),
    maxAge: maxAgeSec,
  };
}

/**
 * 安全讀取 JSON body：解析失敗、不是物件或超過 maxBytes 時回 null（呼叫端回 400），
 * 不讓壞掉的 body 變成 500。
 */
export async function readJsonBody(
  req: Request,
  maxBytes = 64 * 1024,
): Promise<Record<string, unknown> | null> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > maxBytes) return null;
  let text: string;
  try {
    text = await req.text();
  } catch {
    return null;
  }
  if (Buffer.byteLength(text) > maxBytes) return null;
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** 取 body 內的字串欄位；不是字串就回 undefined（避免 `.trim is not a function`） */
export function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

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
  // 條件式更新：併發兩次消費同一權杖時只有一次成功
  const r = await prisma.authToken.updateMany({
    where: { id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (r.count !== 1) return null;
  return t.userId;
}

/**
 * 是否在 API 回應裡直接回傳 Email「驗證」連結（register / resend-verify；demo 用，尚未接 SMTP）。
 * AUTH_DEV_LINKS=on/off 明確指定；未設時 production 關閉。
 * 驗證連結只能驗證「自己這個已登入帳號」的 Email，外洩風險有限。
 */
export function devAuthLinksEnabled(): boolean {
  if (process.env.AUTH_DEV_LINKS === "off") return false;
  if (process.env.AUTH_DEV_LINKS === "on") return true;
  return process.env.NODE_ENV !== "production";
}

/**
 * 是否在 /api/auth/forgot 的回應裡直接回傳「密碼重設」連結。
 * 這等於把接管帳號的權杖交給匿名請求者，所以要雙重條件：AUTH_DEV_RESET_LINKS=on 且不是 production。
 */
export function devResetLinksEnabled(): boolean {
  return (
    process.env.AUTH_DEV_RESET_LINKS === "on" &&
    process.env.NODE_ENV !== "production"
  );
}

/** 密碼規則：8-72 字元、不可等於 Email */
export function validatePassword(password: string, email: string): string | null {
  if (password.length < 8) return "weak_password";
  if (password.length > 72) return "weak_password";
  if (password.trim().toLowerCase() === email.trim().toLowerCase())
    return "weak_password";
  return null;
}

// ================= 帳號刪除 =================
/**
 * 刪除使用者與其所有個人資料（單一交易，全部成功或全部不動）：
 * - 以他為任一方的互盤 MatchRun，及其 SwarmPart、SoloBaseline、破冰卡（含對方看他的那張）
 * - 他自己的破冰卡、帳本、聯絡（連同整段私訊）、他發的隊伍訊息、隊伍成員資格
 *   （移除後剩不到 2 人的隊伍整隊刪除）、自己的組隊假設評估 part（teamId = h:<uid>）
 *   以及別人假設裡含他的 team_eval part（id = t:<owner>:<a>:<b>）
 * - Session、AuthToken、AgentProfile（訪談逐字稿/檔案/GitHub 驗證）、活動成員資格、User 本身
 * 回傳刪除的 MatchRun 數（給呼叫端記錄用）。
 */
export async function deleteUserAndData(uid: string): Promise<{ runs: number }> {
  return prisma.$transaction(async (tx) => {
    const runs = await tx.matchRun.findMany({
      where: { OR: [{ userAId: uid }, { userBId: uid }] },
      select: { id: true },
    });
    const runIds = runs.map((r) => r.id);

    await tx.swarmPart.deleteMany({
      where: {
        OR: [
          { runId: { in: runIds } },
          { teamId: `h:${uid}` },
          {
            kind: "team_eval",
            OR: [{ id: { endsWith: `:${uid}` } }, { id: { contains: `:${uid}:` } }],
          },
        ],
      },
    });
    await tx.soloBaseline.deleteMany({ where: { runId: { in: runIds } } });
    await tx.icebreaker.deleteMany({
      where: { OR: [{ viewerId: uid }, { runId: { in: runIds } }] },
    });
    await tx.matchRun.deleteMany({ where: { id: { in: runIds } } });

    // 私訊隨 Connection cascade 刪除；保險起見也刪他發的訊息
    await tx.connectMessage.deleteMany({ where: { senderId: uid } });
    await tx.connection.deleteMany({
      where: { OR: [{ userAId: uid }, { userBId: uid }] },
    });

    const memberships = await tx.teamMember.findMany({
      where: { userId: uid },
      select: { teamId: true },
    });
    await tx.teamMessage.deleteMany({ where: { senderId: uid } });
    await tx.teamMember.deleteMany({ where: { userId: uid } });
    const teamIds = memberships.map((m) => m.teamId);
    if (teamIds.length) {
      const teams = await tx.team.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, _count: { select: { members: true } } },
      });
      const orphanTeams = teams.filter((t) => t._count.members < 2).map((t) => t.id);
      if (orphanTeams.length)
        await tx.team.deleteMany({ where: { id: { in: orphanTeams } } });
    }

    await tx.ledgerEvent.deleteMany({ where: { userId: uid } });
    await tx.session.deleteMany({ where: { userId: uid } });
    await tx.authToken.deleteMany({ where: { userId: uid } });
    await tx.agentProfile.deleteMany({ where: { userId: uid } });
    await tx.eventMember.deleteMany({ where: { userId: uid } });
    await tx.user.delete({ where: { id: uid } });
    return { runs: runIds.length };
  });
}
