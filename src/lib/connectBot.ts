import { prisma } from "./db";
import { publish } from "./bus";
import { LLM_MODE, llm } from "./llm";
import type { HackathonProfile } from "./types";
import type { Locale } from "./i18n-dict";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 送給 LLM 的私訊歷史只取最近幾則（只含 senderId + content，不帶任何其他欄位） */
export const DM_HISTORY_LIMIT = 20;

/**
 * 一對一私訊：模擬對象延遲回覆。
 * 回傳的 Promise 一定 resolve（錯誤只寫 log）；路由要用 next/server 的 after() 包起來，
 * 讓平台／graceful shutdown 等它跑完，而不是回應送出後就被丟掉。
 */
export function scheduleConnectReply(
  connectionId: string,
  humanSenderId: string,
  locale: Locale = "zh",
): Promise<void> {
  return (async () => {
    try {
      const delay = LLM_MODE === "mock" ? 1500 + Math.random() * 1500 : 400;
      await sleep(delay);

      const conn = await prisma.connection.findUnique({
        where: { id: connectionId },
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: DM_HISTORY_LIMIT,
            select: { senderId: true, content: true },
          },
        },
      });
      if (!conn || conn.status !== "connected") return;

      const otherId =
        conn.userAId === humanSenderId ? conn.userBId : conn.userAId;
      const other = await prisma.user.findUnique({
        where: { id: otherId },
        include: { profile: true },
      });
      if (!other?.isBot) return;
      const profile = other.profile?.compiled as unknown as HackathonProfile | null;
      if (!profile?.role) return;

      const history = conn.messages
        .slice()
        .reverse()
        .map((m) => ({ senderId: m.senderId, content: m.content }));

      publish(`connect:${connectionId}`, { type: "typing", userId: otherId });
      const reply = await llm.dmReply(
        profile,
        history,
        otherId,
        connectionId,
        locale,
      );
      if (!reply) return;

      const msg = await prisma.connectMessage.create({
        data: { connectionId, senderId: otherId, content: reply },
      });
      publish(`connect:${connectionId}`, { type: "message", message: msg });
    } catch (e) {
      console.error("connect reply failed", e);
    }
  })();
}
