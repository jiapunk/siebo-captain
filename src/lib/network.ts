import { prisma } from "./db";
import { summarizeLedger } from "./ledger";
import type { DecideAnswer } from "./llm/decide";
import { roleGroup } from "./llm/mock";
import { isRedacted, publicProfile } from "./profile";
import {
  blendTeamScore,
  latestRoundHypotheses,
  passesHardConstraints,
  pickNonOverlapping,
  teamEvalScore,
} from "./teamAssembler";
import type { HackathonProfile, VisibilityMap } from "./types";

/**
 * 合作網絡（P2）：以「已成立的隊伍」與「持續聯絡」為邊（只限同一場活動），
 * 計算聚類係數等指標；並用最新一輪的隊伍假設，在兩種選人信號下各跑一次選隊（不寫 DB）
 *   social     = 只看互盤評估分
 *   competence = 加入 Agent Ledger 能力分
 * 把選出的隊伍（三人＝三角形）加上既有連線建圖，比較兩種信號形成的網絡（對照 EvoX 實驗二）。
 */

export interface GraphNode {
  id: string;
  name: string;
  emoji: string;
  /** 依分享權限投影後的角色（隱藏時為「未公開」） */
  role: string;
  isBot: boolean;
  competence: number;
  degree: number;
}

export interface SimResult {
  /** 模擬圖的總邊數（既有連線 + 選出隊伍的三角形） */
  edges: number;
  /** 模擬新增、原本不存在的邊數 */
  addedEdges: number;
  /** 標準平均聚類係數（所有節點平均，degree < 2 記 0） */
  clustering: number;
  /** 模擬圖中兩端角色群不同的邊數（任一端角色未公開或未知不計） */
  crossGroup: number;
  /** 本信號下選出的隊伍（兩位隊友 id） */
  picked: [string, string][];
  /** 模擬新增的邊 */
  newEdges: [string, string][];
}

export interface NetworkPayload {
  mode: "social" | "competence";
  nodes: GraphNode[];
  edges: [string, string][];
  metrics: {
    edges: number;
    avgDegree: number;
    /** 標準平均聚類係數（所有節點平均，孤立／degree 1 的節點記 0） */
    clustering: number;
    hubs: { id: string; name: string; degree: number }[];
  };
  sim: {
    social: SimResult;
    competence: SimResult;
    /** 最新一輪組裝的假設數（已過濾到同活動成員） */
    hypotheses: number;
  } | null;
}

export const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const splitKey = (e: string) => e.split("|") as [string, string];

/**
 * 無向圖的標準平均聚類係數（Watts–Strogatz / networkx average_clustering）：
 * 每個節點 C_i = 鄰居間實際連線數 / 可能連線數；degree < 2 的節點 C_i = 0；對「所有節點」取平均。
 * 結果四捨五入到小數兩位。
 */
export function clusteringCoefficient(nodes: Iterable<string>, edges: Iterable<string>): number {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n, new Set());
  for (const e of edges) {
    const [a, b] = splitKey(e);
    if (a === b) continue;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }
  if (adj.size === 0) return 0;
  let sum = 0;
  for (const [, nb] of adj) {
    const k = nb.size;
    if (k < 2) continue; // 記 0，但仍計入分母
    const list = [...nb];
    let links = 0;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (adj.get(list[i])?.has(list[j])) links++;
    sum += (2 * links) / (k * (k - 1));
  }
  return Math.round((sum / adj.size) * 100) / 100;
}

export interface SimHypothesis {
  a: string;
  b: string;
  /** 隊伍評估原始分（0–100） */
  raw: number;
  /** 兩位隊友的帳本能力分平均 */
  compAvg: number;
  /** 是否通過與 assembleTeams 相同的硬約束 */
  eligible: boolean;
}

/**
 * 在某個選人信號下跑一次選隊（純函式、不寫 DB）：
 * 通過硬約束的假設 → 依信號算分 → 不重疊貪婪（與 assembleTeams 同一個 pickNonOverlapping）→
 * 每隊 = 擁有者 + 兩位隊友的三角形，加上既有邊建圖，量聚類與跨群連結。
 */
export function simulateSignal(opts: {
  ownerId: string;
  hyps: SimHypothesis[];
  mode: "social" | "competence";
  nodes: Iterable<string>;
  baseEdges: Iterable<string>;
  /** 角色群；回傳 null 代表未知／未公開 */
  groupOf: (id: string) => string | null;
}): SimResult {
  const scored = opts.hyps
    .filter((h) => h.eligible && h.a !== h.b)
    .map((h) => ({
      hyp: { a: { userId: h.a }, b: { userId: h.b } },
      report: { score: blendTeamScore(h.raw, h.compAvg, opts.mode) },
    }));
  const picked = pickNonOverlapping(scored).map(
    (s) => [s.hyp.a.userId, s.hyp.b.userId] as [string, string],
  );

  const base = new Set(opts.baseEdges);
  const graph = new Set(base);
  const nodes = new Set(opts.nodes);
  nodes.add(opts.ownerId);
  const added = new Set<string>();
  for (const [a, b] of picked) {
    nodes.add(a);
    nodes.add(b);
    for (const e of [edgeKey(opts.ownerId, a), edgeKey(opts.ownerId, b), edgeKey(a, b)]) {
      if (!graph.has(e)) added.add(e);
      graph.add(e);
    }
  }

  let crossGroup = 0;
  for (const e of graph) {
    const [a, b] = splitKey(e);
    const ga = opts.groupOf(a);
    const gb = opts.groupOf(b);
    if (ga && gb && ga !== gb) crossGroup++;
  }

  return {
    edges: graph.size,
    addedEdges: added.size,
    clustering: clusteringCoefficient(nodes, graph),
    crossGroup,
    picked,
    newEdges: [...added].map(splitKey),
  };
}

/** 依分享權限取角色群；未公開或無法辨識 → null */
function groupOfRole(role: string): string | null {
  if (!role || isRedacted(role) || role === "—") return null;
  const g = roleGroup(role);
  return g === "other" ? null : g;
}

export async function buildNetwork(userId: string): Promise<NetworkPayload> {
  const mode: NetworkPayload["mode"] =
    process.env.ASSEMBLY_SIGNAL === "social" ? "social" : "competence";

  const membership = await prisma.eventMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: "desc" },
  });
  const eventId = membership?.eventId ?? null;

  // 沒有活動 → 不回任何全域資料
  if (!eventId) {
    return {
      mode,
      nodes: [],
      edges: [],
      metrics: { edges: 0, avgDegree: 0, clustering: 0, hubs: [] },
      sim: null,
    };
  }

  const members = await prisma.eventMember.findMany({
    where: { eventId },
    include: { user: { include: { profile: true } } },
  });
  const ids = members.map((m) => m.userId);
  const memberSet = new Set(ids);
  const ledger = await summarizeLedger(ids);

  // 邊：同活動已成立隊伍的成員配對 + 兩端都是本活動成員的持續聯絡
  const [teams, conns] = await Promise.all([
    prisma.team.findMany({
      where: { status: "assembled", eventId },
      include: { members: true },
    }),
    prisma.connection.findMany({
      where: {
        status: "connected",
        userAId: { in: ids },
        userBId: { in: ids },
      },
    }),
  ]);

  const edges = new Set<string>();
  for (const t of teams) {
    const ms = t.members.map((m) => m.userId).filter((id) => memberSet.has(id));
    for (let i = 0; i < ms.length; i++)
      for (let j = i + 1; j < ms.length; j++) edges.add(edgeKey(ms[i], ms[j]));
  }
  for (const c of conns) edges.add(edgeKey(c.userAId, c.userBId));

  const degree = new Map<string, number>();
  for (const e of edges) {
    const [a, b] = splitKey(e);
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }

  const roleOf = new Map<string, string>();
  const nodes: GraphNode[] = members.map(({ user: u }) => {
    const compiled = u.profile?.compiled as unknown as HackathonProfile | null;
    const role = compiled
      ? publicProfile(compiled, (u.profile?.visibility as VisibilityMap) ?? null).role || "—"
      : "—";
    roleOf.set(u.id, role);
    return {
      id: u.id,
      name: u.name,
      emoji: u.emoji,
      role,
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

  // ---- 兩種信號的模擬：只用「最新一輪」組裝的假設（teamId=h:<userId>，舊輪次已封存） ----
  // 舊資料沒有封存、還可能有反向重複的假設 ID（t:o:a:b／t:o:b:a）→ latestRoundHypotheses 切出最新一輪並去重；
  // 先切輪次再取 done，最新一輪全部失敗時不會退回去用上一輪
  const parts = latestRoundHypotheses(
    await prisma.swarmPart.findMany({
      where: { kind: "team_eval", teamId: `h:${userId}` },
    }),
  ).filter((p) => p.status === "done");
  let sim: NetworkPayload["sim"] = null;
  if (parts.length > 0) {
    const hyps: SimHypothesis[] = parts
      .map((p) => {
        const [, , a, b] = p.id.split(":");
        const answers = Array.isArray(p.answers) ? (p.answers as unknown as DecideAnswer[]) : [];
        const raw = teamEvalScore(answers);
        const compAvg = Math.round(
          ((ledger.get(a)?.score ?? 35) + (ledger.get(b)?.score ?? 35)) / 2,
        );
        return { a, b, raw, compAvg, eligible: passesHardConstraints(raw, answers) };
      })
      .filter((h) => h.a && h.b && memberSet.has(h.a) && memberSet.has(h.b));

    const groupOf = (id: string) => groupOfRole(roleOf.get(id) ?? "");
    const run = (m: "social" | "competence") =>
      simulateSignal({ ownerId: userId, hyps, mode: m, nodes: ids, baseEdges: edges, groupOf });
    sim = { social: run("social"), competence: run("competence"), hypotheses: hyps.length };
  }

  return {
    mode,
    nodes,
    edges: [...edges].map(splitKey),
    metrics: {
      edges: edges.size,
      avgDegree,
      clustering: clusteringCoefficient(ids, edges),
      hubs,
    },
    sim,
  };
}
