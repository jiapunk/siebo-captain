import { prisma } from "./db";
import { publish } from "./bus";
import { LLM_MODE, llm } from "./llm";
import type { Locale } from "./i18n-dict";
import type { HackathonProfile } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 送給 LLM 的群聊歷史只取最近幾則（只含 senderId + content，不帶任何其他欄位） */
export const TEAM_HISTORY_LIMIT = 20;

/**
 * 團隊聊天：選一位模擬隊友回話（輪流），並先送 typing 事件。
 * 回傳的 Promise 一定 resolve（錯誤只寫 log）；路由要用 next/server 的 after() 包起來，
 * 讓平台／graceful shutdown 等它跑完，而不是回應送出後就被丟掉。
 */
export function scheduleTeamReply(
  teamId: string,
  humanSenderId: string,
  locale: Locale = "zh",
): Promise<void> {
  return (async () => {
    try {
      const delay = LLM_MODE === "mock" ? 1400 + Math.random() * 1600 : 300;
      await sleep(delay);

      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { members: true },
      });
      if (!team || team.status !== "assembled") return;

      const memberIds = team.members.map((m) => m.userId);
      const users = await prisma.user.findMany({
        where: { id: { in: memberIds }, isBot: true },
        include: { profile: true },
      });
      const bots = users.filter((u) => u.isBot);
      if (bots.length === 0) return;

      // 輪流：選回話次數最少的隊友（用 groupBy 計數，不必把整段歷史載入記憶體）
      const counts = await prisma.teamMessage.groupBy({
        by: ["senderId"],
        where: { teamId, senderId: { in: bots.map((b) => b.id) } },
        _count: { _all: true },
      });
      const replyCount = new Map(counts.map((c) => [c.senderId, c._count._all]));
      const bot = bots.sort(
        (a, b) => (replyCount.get(a.id) ?? 0) - (replyCount.get(b.id) ?? 0),
      )[0];
      const profile = bot.profile?.compiled as unknown as HackathonProfile | null;
      if (!profile?.role) return;

      const recent = await prisma.teamMessage.findMany({
        where: { teamId },
        orderBy: { createdAt: "desc" },
        take: TEAM_HISTORY_LIMIT,
        select: { senderId: true, content: true },
      });
      const history = recent
        .reverse()
        .map((m) => ({ senderId: m.senderId, content: m.content }));

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
