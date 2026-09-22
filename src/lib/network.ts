import { prisma } from "./db";
import { summarizeLedger, type CompetenceSummary } from "./ledger";
import { scoreOf, type DecideAnswer } from "./llm/decide";

/**
 * 合作網絡（P2）：以「已成立的隊伍」與「持續聯絡」為邊，
 * 計算聚類係數等指標；並用同一批隊伍假設模擬
 *   social     = 只看互盤評估分
 *   competence = 加入 Agent Ledger 能力分
 * 兩種選人信號會形成哪種網絡（對照 EvoX 實驗二）。
 */

export interface GraphNode {
  id: string;
  name: string;
  emoji: string;
  role: string;
  isBot: boolean;
  competence: number;
  degree: number;
}

export interface NetworkPayload {
  mode: "social" | "competence";
  nodes: GraphNode[];
  edges: [string, string][];
  metrics: {
    edges: number;
    avgDegree: number;
    clustering: number;
    hubs: { id: string; name: string; degree: number }[];
  };
  sim: {
    social: { edges: number; clustering: number; crossGroup: number; newEdges: [string, string][] };
    competence: { edges: number; clustering: number; crossGroup: number; newEdges: [string, string][] };
    hypotheses: number;
  } | null;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** 無向圖平均聚類係數（只計 degree ≥ 2 的節點） */
function clustering(nodes: string[], edges: Set<string>): number {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n, new Set());
  for (const e of edges) {
    const [a, b] = e.split("|");
    adj.get(a)?.add(b);
    adj.get(b)?.add(a);
  }
  let sum = 0;
  let count = 0;
  for (const [, nb] of adj) {
    const k = nb.size;
    if (k < 2) continue;
    const list = [...nb];
    let links = 0;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (adj.get(list[i])?.has(list[j])) links++;
    sum += (2 * links) / (k * (k - 1));
    count++;
  }
  return count === 0 ? 0 : Math.round((sum / count) * 100) / 100;
}

/** 貪婪不重疊選隊（與 teamAssembler 匯合一致） */
function greedyPick(
  scored: { a: string; b: string; score: number }[],
  limit = 3,
): [string, string][] {
  scored.sort((x, y) => y.score - x.score);
  const picked: [string, string][] = [];
  const used = new Set<string>();
  for (const s of scored) {
    if (picked.length >= limit) break;
    if (used.has(s.a) || used.has(s.b)) continue;
    picked.push([s.a, s.b]);
    used.add(s.a);
    used.add(s.b);
  }
  return picked;
}

export async function buildNetwork(userId: string): Promise<NetworkPayload> {
  const membership = await prisma.eventMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: "desc" },
  });
  const eventId = membership?.eventId ?? null;

  const members = eventId
    ? await prisma.eventMember.findMany({
        where: { eventId },
        include: { user: { include: { profile: true } } },
      })
    : [];

  const ids = members.map((m) => m.userId);
  const ledger = await summarizeLedger(ids);

  const nodeIds = new Set<string>(ids);
  nodeIds.add(userId);

  // 邊：已成立隊伍的成員配對 + 持續聯絡
  const [teams, conns] = await Promise.all([
    prisma.team.findMany({
      where: { status: "assembled", ...(eventId ? { eventId } : {}) },
      include: { members: true },
    }),
    prisma.connection.findMany({
      where: { status: "connected" },
    }),
  ]);

  const edges = new Set<string>();
  for (const t of teams) {
    const ms = t.members.map((m) => m.userId);
    for (let i = 0; i < ms.length; i++)
      for (let j = i + 1; j < ms.length; j++) {
        nodeIds.add(ms[i]);
        nodeIds.add(ms[j]);
        edges.add(pairKey(ms[i], ms[j]));
      }
  }
  for (const c of conns) {
    if (nodeIds.has(c.userAId) || nodeIds.has(c.userBId)) {
      nodeIds.add(c.userAId);
      nodeIds.add(c.userBId);
      edges.add(pairKey(c.userAId, c.userBId));
    }
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...nodeIds] } },
    include: { profile: true },
  });
  const degree = new Map<string, number>();
  for (const e of edges) {
    const [a, b] = e.split("|");
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }

  const nodes: GraphNode[] = users.map((u) => {
    const compiled = u.profile?.compiled as unknown as { role?: string } | null;
    return {
      id: u.id,
      name: u.name,
      emoji: u.emoji,
      role: compiled?.role ?? "—",
      isBot: u.isBot,
      competence: ledger.get(u.id)?.score ?? 35,
      degree: degree.get(u.id) ?? 0,
    };
  });

  const hubs = [...nodes]
    .sort((x, y) => y.degree - x.degree)
    .filter((n) => n.degree > 0)
    .slice(0, 3)
    .map((n) => ({ id: n.id, name: n.name, degree: n.degree }));

  const avgDegree =
    nodes.length === 0
      ? 0
      : Math.round(((2 * edges.size) / nodes.length) * 100) / 100;

  // ---- 兩種信號的模擬（同一批 team_eval 假設，重跑匯合；不寫 DB） ----
  const parts = await prisma.swarmPart.findMany({
    where: { kind: "team_eval", id: { startsWith: `t:${userId}:` } },
  });
  let sim: NetworkPayload["sim"] = null;
  if (parts.length > 0) {
    const hyps = parts
      .map((p) => {
        const seg = p.id.split(":");
        const a = seg[2];
        const b = seg[3];
        const answers = (p.answers as unknown as DecideAnswer[]) ?? [];
        const raw = Math.max(
          0,
          Math.min(100, Math.round((scoreOf(answers, "s_overall", 6) / 9) * 100)),
        );
        const compAvg = Math.round(
          ((ledger.get(a)?.score ?? 35) + (ledger.get(b)?.score ?? 35)) / 2,
        );
        return { a, b, raw, compAvg };
      })
      .filter((h) => h.a && h.b);

    const socialPicked = greedyPick(
      hyps.map((h) => ({ a: h.a, b: h.b, score: h.raw })),
    );
    const compPicked = greedyPick(
      hyps.map((h) => ({
        a: h.a,
        b: h.b,
        score: Math.round(h.raw * 0.75 + h.compAvg * 0.25),
      })),
    );

    const roleOf = new Map(
      users.map((u) => [
        u.id,
        ((u.profile?.compiled as unknown as { role?: string } | null)?.role ?? "").trim(),
      ]),
    );
    const cross = (picks: [string, string][]) =>
      picks.filter(([a, b]) => {
        const ra = roleOf.get(a) ?? "";
        const rb = roleOf.get(b) ?? "";
        return ra && rb && ra !== rb;
      }).length;

    const simNodes = new Set<string>([userId]);
    for (const h of hyps) {
      simNodes.add(h.a);
      simNodes.add(h.b);
    }
    const socialSet = new Set(socialPicked.map(([a, b]) => pairKey(a, b)));
    const compSet = new Set(compPicked.map(([a, b]) => pairKey(a, b)));

    sim = {
      social: {
        edges: socialSet.size,
        clustering: clustering([...simNodes], socialSet),
        crossGroup: cross(socialPicked),
        newEdges: socialPicked,
      },
      competence: {
        edges: compSet.size,
        clustering: clustering([...simNodes], compSet),
        crossGroup: cross(compPicked),
        newEdges: compPicked,
      },
      hypotheses: hyps.length,
    };
  }

  return {
    mode:
      process.env.ASSEMBLY_SIGNAL === "social" ? "social" : "competence",
    nodes,
    edges: [...edges].map((e) => e.split("|") as [string, string]),
    metrics: {
      edges: edges.size,
      avgDegree,
      clustering: clustering([...nodeIds], edges),
      hubs,
    },
    sim,
  };
}
