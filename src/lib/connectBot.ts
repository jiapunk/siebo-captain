import { prisma } from "./db";
import { publish } from "./bus";
import { LLM_MODE, llm } from "./llm";
import type { HackathonProfile } from "./types";
import type { Locale } from "./i18n-dict";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 一對一私訊：模擬對象延遲回覆 */
export function scheduleConnectReply(
  connectionId: string,
  humanSenderId: string,
  locale: Locale = "zh",
) {
  void (async () => {
    try {
      const delay = LLM_MODE === "mock" ? 1500 + Math.random() * 1500 : 400;
      await sleep(delay);

      const conn = await prisma.connection.findUnique({
        where: { id: connectionId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
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

      const history = conn.messages.map((m) => ({
        senderId: m.senderId,
        content: m.content,
      }));

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
