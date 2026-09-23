import { cookies } from "next/headers";
import { prisma } from "./db";
import { resolveSessionUserId, SID_COOKIE } from "./auth";

export const UID_COOKIE = "sd_uid";

/** 示範身分切換是否開啟（DEMO_SWITCH=off 整個關閉；未設或其他值視為開啟） */
export function demoSwitchEnabled(): boolean {
  return process.env.DEMO_SWITCH !== "off";
}

/**
 * 「示範身分」＝ passwordHash 與 email 都是 null 的使用者（種子角色、bot、首頁建立的示範選手）。
 * 真帳號（有 email 或密碼）永遠不是示範身分，不能被 sd_uid 切換或冒用。
 * Prisma where 條件，給需要列出/篩選示範身分的查詢共用。
 */
export const DEMO_IDENTITY_WHERE = { passwordHash: null, email: null } as const;

/** uid 是否為存在的示範身分 */
export async function isDemoIdentity(uid: string): Promise<boolean> {
  if (!uid) return false;
  const u = await prisma.user.findFirst({
    where: { id: uid, ...DEMO_IDENTITY_WHERE },
    select: { id: true },
  });
  return Boolean(u);
}

/**
 * 解析當前身分：
 *  1) 真 Auth：sc_sid（Session token）有效時永遠以它為準
 *  2) Demo 身分切換：sd_uid，只在 DEMO_SWITCH 未關閉、且該 id 在 DB 裡確實是示範身分時才採用
 *     （cookie 值是客戶端可任意設定的明文，所以每次都要回 DB 驗證，不能直接信任）
 */
export async function getIdentity(): Promise<{
  uid: string | null;
  mode: "session" | "demo" | null;
}> {
  const store = await cookies();
  const sid = store.get(SID_COOKIE)?.value;
  if (sid) {
    const uid = await resolveSessionUserId(sid);
    if (uid) return { uid, mode: "session" };
  }
  const demoUid = store.get(UID_COOKIE)?.value;
  if (demoUid && demoSwitchEnabled() && (await isDemoIdentity(demoUid)))
    return { uid: demoUid, mode: "demo" };
  return { uid: null, mode: null };
}

/** 取得當前使用者 id（見 getIdentity；未登入或 sd_uid 無效時回 null） */
export async function getCurrentUserId(): Promise<string | null> {
  return (await getIdentity()).uid;
}

/** 當前身分是否來自真帳號登入（而非 demo 切換） */
export async function getAuthMode(): Promise<"session" | "demo" | null> {
  return (await getIdentity()).mode;
}
