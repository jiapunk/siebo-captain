import { cookies } from "next/headers";
import { resolveSessionUserId, SID_COOKIE } from "./auth";

export const UID_COOKIE = "sd_uid";

/**
 * 取得當前使用者：
 *  1) 真 Auth：sc_sid（Session token）
 *  2) Demo 身分切換：sd_uid（僅供展示用）
 */
export async function getCurrentUserId(): Promise<string | null> {
  const store = await cookies();
  const sid = store.get(SID_COOKIE)?.value;
  if (sid) {
    const uid = await resolveSessionUserId(sid);
    if (uid) return uid;
  }
  return store.get(UID_COOKIE)?.value ?? null;
}

/** 當前身分是否來自真帳號登入（而非 demo 切換） */
export async function getAuthMode(): Promise<"session" | "demo" | null> {
  const store = await cookies();
  const sid = store.get(SID_COOKIE)?.value;
  if (sid) {
    const uid = await resolveSessionUserId(sid);
    if (uid) return "session";
  }
  if (store.get(UID_COOKIE)?.value) return "demo";
  return null;
}
