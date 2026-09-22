import { prisma } from "./db";
import { publish } from "./bus";
import { LLM_MODE, llm } from "./llm";
import type { Locale } from "./i18n-dict";
import type { HackathonProfile } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 團隊聊天：選一位模擬隊友回話（輪流），並先送 typing 事件 */
export function scheduleTeamReply(
  teamId: string,
  humanSenderId: string,
  locale: Locale = "zh",
) {
  void (async () => {
    try {
      const delay = LLM_MODE === "mock" ? 1400 + Math.random() * 1600 : 300;
      await sleep(delay);

      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: {
          members: true,
          messages: { orderBy: { createdAt: "asc" } },
        },
      });
      if (!team || team.status !== "assembled") return;

      const memberIds = team.members.map((m) => m.userId);
      const users = await prisma.user.findMany({
        where: { id: { in: memberIds } },
        include: { profile: true },
      });
      const bots = users.filter((u) => u.isBot);
      if (bots.length === 0) return;

      // 輪流：選回話次數最少的隊友
      const replyCount = new Map<string, number>();
      for (const m of team.messages) {
        if (m.senderId !== humanSenderId)
          replyCount.set(m.senderId, (replyCount.get(m.senderId) ?? 0) + 1);
      }
      const bot = bots.sort(
        (a, b) => (replyCount.get(a.id) ?? 0) - (replyCount.get(b.id) ?? 0),
      )[0];
      const profile = bot.profile?.compiled as unknown as HackathonProfile | null;
      if (!profile?.role) return;

      const history = team.messages.map((m) => ({
        senderId: m.senderId,
        content: m.content,
      }));

      publish(`team:${teamId}`, { type: "typing", userId: bot.id });

      const reply = await llm.teamReply(profile, history, bot.id, teamId, locale);
      if (!reply) return;

      const msg = await prisma.teamMessage.create({
        data: { teamId, senderId: bot.id, content: reply },
      });
      publish(`team:${teamId}`, { type: "message", message: msg });
    } catch (e) {
      console.error("team reply failed", e);
    }
  })();
}
