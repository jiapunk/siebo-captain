import { prisma } from "./db";

/**
 * Agent Ledger（P2）：append-only 戰績帳本 + 能力摘要
 * 設計對齊 EvoMap 的「recall before, record after」：
 *   - 行為發生時 recordLedger()（成隊、建立聯絡、送出訊息、生成破冰卡）
 *   - 選人前 summarizeLedger() 取能力分，供組裝器加權
 */

export type LedgerKind =
  | "team_joined"
  | "connection"
  | "message_sent"
  | "icebreaker";

export async function recordLedger(
  userId: string,
  kind: LedgerKind,
  value = 1,
  refId?: string,
): Promise<void> {
  try {
    await prisma.ledgerEvent.create({
      data: { userId, kind, value, refId: refId ?? null },
    });
  } catch (e) {
    // 帳本絕不阻斷主流程
    console.warn("ledger record failed", e);
  }
}

export interface CompetenceSummary {
  userId: string;
  teams: number; // 加入過幾支隊伍
  connections: number; // 建立過幾條持續聯絡
  messages: number; // 主動送出的訊息數
  icebreakers: number; // 生成過的破冰卡
  avgTeamScore: number; // 加入隊伍的平均分
  score: number; // 0-100 綜合能力分
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/**
 * 能力分公式（純函式）：基準 35
 *   + 隊伍 ×8（上限 20）+ 聯絡 ×5（上限 15）+ 訊息 ×0.5（上限 10）
 *   + 有隊伍時 平均隊伍分 ×0.15（上限 15）+ 破冰卡 ×1（上限 5）
 * 四捨五入後夾在 30–98。
 */
export function competenceScore(
  s: Pick<CompetenceSummary, "teams" | "connections" | "messages" | "icebreakers" | "avgTeamScore">,
): number {
  return clamp(
    Math.round(
      35 +
        Math.min(20, s.teams * 8) +
        Math.min(15, s.connections * 5) +
        Math.min(10, s.messages * 0.5) +
        (s.teams > 0 ? Math.min(15, s.avgTeamScore * 0.15) : 0) +
        Math.min(5, s.icebreakers * 1),
    ),
    30,
    98,
  );
}

/** 取多人的能力摘要（單次 groupBy，無 N+1） */
export async function summarizeLedger(
  userIds: string[],
): Promise<Map<string, CompetenceSummary>> {
  const out = new Map<string, CompetenceSummary>();
  if (userIds.length === 0) return out;

  const rows = await prisma.ledgerEvent.groupBy({
    by: ["userId", "kind"],
    where: { userId: { in: userIds } },
    _count: { _all: true },
    _sum: { value: true },
  });

  const base = new Map<string, CompetenceSummary>();
  for (const id of userIds) {
    base.set(id, {
      userId: id,
      teams: 0,
      connections: 0,
      messages: 0,
      icebreakers: 0,
      avgTeamScore: 0,
      score: 0,
    });
  }
  for (const r of rows) {
    const s = base.get(r.userId);
    if (!s) continue;
    const n = r._count._all;
    if (r.kind === "team_joined") {
      s.teams = n;
      s.avgTeamScore = n > 0 ? (r._sum.value ?? 0) / n : 0;
    } else if (r.kind === "connection") s.connections = n;
    else if (r.kind === "message_sent") s.messages = n;
    else if (r.kind === "icebreaker") s.icebreakers = n;
  }

  for (const s of base.values()) {
    s.score = competenceScore(s);
    out.set(s.userId, s);
  }
  return out;
}
