import { prisma } from "@/lib/db";
import { publish } from "@/lib/bus";
import { recordLedger } from "@/lib/ledger";

/**
 * 持續聯絡的狀態：
 *   - 對模擬對象（bot）：建立即 connected
 *   - 真人對真人：先 requested，只有被邀請者能接受（POST /api/connections/[id]/accept，
 *     或被邀請者自己也按一次「保持聯絡」＝接受）→ connected
 * requested 的列以 userAId = 發起者、userBId = 被邀請者 儲存（同一對人不論方向只會有一列）。
 */
export type Direction = "outgoing" | "incoming" | null;

/** 以 uid 的視角：requested 時我是發起者（outgoing）或被邀請者（incoming）；connected 為 null */
export function directionOf(
  conn: { status: string; userAId: string; userBId: string },
  uid: string,
): Direction {
  if (conn.status !== "requested") return null;
  return conn.userAId === uid ? "outgoing" : "incoming";
}

/** 把 requested 升級成 connected；只有真的升級的那一次會記帳本（雙方各一筆） */
export async function acceptConnection(
  id: string,
  userAId: string,
  userBId: string,
): Promise<void> {
  const { count } = await prisma.connection.updateMany({
    where: { id, status: "requested" },
    data: { status: "connected" },
  });
  if (count === 1) {
    await recordLedger(userAId, "connection", 1, id);
    await recordLedger(userBId, "connection", 1, id);
    publish(`connect:${id}`, { type: "accepted" });
  }
  publish(`user:${userAId}`, { type: "refresh" });
  publish(`user:${userBId}`, { type: "refresh" });
}
