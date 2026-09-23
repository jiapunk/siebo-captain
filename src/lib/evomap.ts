import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";

/**
 * EvoMap GEP-A2A 適配層（P3，opt-in）
 *   - hello：免 key 註冊節點（取得 node_secret 與 claim_url）
 *   - validate / publish：Gene + Capsule bundle（內容定址 sha256）；validate 沒過不發佈
 *     （CLI：npm run evomap:release；網頁：POST /api/evomap 僅限 EVOMAP_ADMIN_USER_IDS 的真帳號）
 *   - fetch：搜尋網路上的既有基因（search_only 免費）
 *   Capsule 的 outcome / execution_trace 由 DB 實際紀錄計算（collectAssemblyEvidence），算不出來就省略。
 *   全部 fail-open：任何錯誤都不阻斷主要流程。
 */

const PROTOCOL = "gep-a2a";
const PROTOCOL_VERSION = "1.0.0";

export function base(): string {
  return (process.env.EVOMAP_BASE ?? "https://evomap.ai").replace(/\/+$/, "");
}
export function enabled(): boolean {
  return process.env.EVOMAP_ENABLED === "1";
}
export function nodeId(): string {
  return process.env.EVOMAP_NODE_ID ?? "";
}
function nodeSecret(): string {
  return process.env.EVOMAP_NODE_SECRET ?? "";
}
export function linked(): boolean {
  return Boolean(nodeId() && nodeSecret());
}

export interface EvoResult<T = unknown> {
  ok: boolean;
  status?: number;
  data?: T;
  error?: string;
}

function envelope(messageType: string, payload: Record<string, unknown>) {
  return {
    protocol: PROTOCOL,
    protocol_version: PROTOCOL_VERSION,
    message_type: messageType,
    message_id: `msg_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    sender_id: nodeId() || undefined,
    timestamp: new Date().toISOString(),
    payload,
  };
}

async function post<T>(
  path: string,
  body: unknown,
  opts?: { auth?: boolean; timeoutMs?: number },
): Promise<EvoResult<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 15_000);
  try {
    const res = await fetch(`${base()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts?.auth && nodeSecret()
          ? { Authorization: `Bearer ${nodeSecret()}` }
          : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: T | undefined;
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = undefined;
    }
    if (!res.ok)
      return { ok: false, status: res.status, data, error: text.slice(0, 300) };
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 內容定址（canonical JSON，鍵排序） ----------
export function canonicalJson(value: unknown, depth = 0): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((v) => canonicalJson(v, depth + 1)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k], depth + 1)}`)
    .join(",")}}`;
}

export function computeAssetId(asset: Record<string, unknown>): string {
  const { asset_id: _drop, ...rest } = asset;
  void _drop;
  const hash = createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex");
  return `sha256:${hash}`;
}

// ---------- 資產 ----------
export interface TraceStep {
  step: number;
  stage: string;
  cmd: string;
  exit: number;
}

export interface GeneAsset {
  type: "Gene";
  schema_version: "1.5.0";
  category: "repair" | "optimize" | "innovate" | "regulatory" | "explore";
  signals_match: string[];
  summary: string;
  strategy: string[];
  validation: string[];
  asset_id: string;
  [k: string]: unknown;
}

/**
 * 選填欄位（execution_trace / success_streak / blast_radius）算不出來就「不放」，
 * 不用寫死的常數充數（canonicalJson 會略過 undefined，所以省略不影響內容定址）。
 */
export interface CapsuleAsset {
  type: "Capsule";
  schema_version: "1.5.0";
  trigger: string[];
  gene: string;
  summary: string;
  content: string;
  strategy: string[];
  code_snippet: string;
  execution_trace?: TraceStep[];
  confidence: number;
  blast_radius?: { files: number; lines: number };
  outcome: { status: "success" | "failed"; score: number };
  success_streak?: number;
  env_fingerprint: { platform: string; arch: string; node_version: string };
  validation: string[];
  asset_id: string;
  [k: string]: unknown;
}

export interface EvolutionEventAsset {
  type: "EvolutionEvent";
  intent: "repair" | "optimize" | "innovate" | "explore";
  capsule_id: string;
  genes_used: string[];
  outcome: { status: "success" | "failed"; score: number };
  mutations_tried?: number;
  total_cycles?: number;
  asset_id: string;
}

const SIGNALS = ["hackathon_teaming", "team_formation", "skill_gap_analysis"];

/**
 * 研究過的前例（recall before solving）：assets/gep/learned/sha256_299eb589.json。
 * GEP 的 Gene / Capsule / EvolutionEvent payload 沒有「引用來源」欄位
 * （genes_used 是「本次實際套用的 Gene」，我們沒有套用它的 Gene，所以不放），
 * 因此只在 Capsule content 以文字註明完整 asset_id，並如實說明只借鏡了打包格式。
 */
export const PRIOR_ART_CAPSULE_ID =
  "sha256:299eb589f78a7a7f04a3b438b07b618b1d56c9e16fff62bc6e87b2c1a2c51d2e";

/**
 * 自包含的驗收指令（node-only、不依賴 repo 檔案）：
 * 逐鍵排序的 canonical JSON 必須與鍵序無關——這是內容定址的核心不變式。
 * （v1 用 `node scripts/...` 被 Hub 標記 validation_cmd_unsandboxable；
 *   參考 promoted 資產 sha256:299eb589… 的做法改為自包含一行。）
 */
const CANONICAL_PROBE =
  "const c=(v)=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(c).join(',')+']':'{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+c(v[k])).join(',')+'}';if(c({b:1,a:[2,3]})!==c({a:[2,3],b:1}))process.exit(1);console.log('canonical-json ok')";
const VALIDATION = [`node -e "${CANONICAL_PROBE}"`];

const BLAST_FILES = [
  "src/lib/swarm.ts",
  "src/lib/teamAssembler.ts",
  "src/lib/ledger.ts",
  "src/lib/evomap.ts",
];

/** 引擎相關檔案的實際行數；任一檔讀不到（例如雲端部署沒有原始碼）就回 null → 欄位省略 */
function repoBlastRadius(): { files: number; lines: number } | null {
  let lines = 0;
  for (const f of BLAST_FILES) {
    try {
      // turbopackIgnore：避免 build 把整個專案（含 prisma/dev.db、demo 快照）trace 進路由產物
      const text = readFileSync(join(/* turbopackIgnore: true */ process.cwd(), f), "utf8");
      lines += text.split("\n").length;
    } catch {
      return null;
    }
  }
  return { files: BLAST_FILES.length, lines };
}

// ---------- 組隊證據（全部從 DB 實際紀錄計算） ----------

/** 同一輪 assembleTeams 裡，兩個 team_eval part 完成時間的最大間隔 */
const CYCLE_GAP_MS = 120_000;
/** 同一輪 assembleTeams 在評估完後連續 prisma.team.create，彼此間隔的上限 */
const BATCH_WINDOW_MS = 10_000;

export interface AssemblyEvidence {
  /** 最新一輪組隊的識別（該輪最新 Team 的 id）；DB 還沒有任何隊伍 → null */
  cycleId: string | null;
  /** 該輪目前留在 DB 的隊伍數 */
  teams: number;
  /** 其中全員已確認（status=assembled）的隊伍數 */
  confirmed: number;
  /** 該輪隊伍的平均分（0–100）；沒有隊伍 → 0 */
  avgScore: number;
  /** 該輪 team_eval parts 的決策層（例 "jev"、"jev+mock"）；查不到 → "unknown" */
  provider: string;
  /** 由 MatchRun / SwarmPart / Team 紀錄組出的步驟；查不到的步驟不放 */
  trace: TraceStep[];
}

type PartRow = { status: string; retries: number; provider: string | null };

function tally(parts: PartRow[]) {
  const done = parts.filter((p) => p.status === "done").length;
  const failed = parts.filter((p) => p.status === "failed").length;
  const retries = parts.reduce((s, p) => s + p.retries, 0);
  const providers = Array.from(
    new Set(parts.map((p) => p.provider).filter((p): p is string => Boolean(p))),
  ).sort();
  return {
    done,
    failed,
    pending: parts.length - done - failed,
    providers: providers.length ? providers.join("+") : "unknown",
    text: `${done}/${parts.length} parts done · ${failed} failed · ${retries} retries · ${providers.length ? providers.join("+") : "provider n/a"}`,
  };
}

/**
 * 從 DB 找出「最新一輪組隊」的實際結果：
 *   - 最新 Team → 成員中最近有 team_eval part（teamId = h:<userId>）的人即發起人
 *   - 同一輪：發起人在 BATCH_WINDOW_MS 內建立的隊伍；team_eval parts 以完成時間分群
 *   - 候選池來源：發起人參與、隊伍建立前已完成的互盤 MatchRun 與其 pair parts
 * 不含任何使用者 id 或姓名（會公開發佈）。
 */
export async function collectAssemblyEvidence(db: PrismaClient): Promise<AssemblyEvidence> {
  const latest = await db.team.findFirst({
    orderBy: { createdAt: "desc" },
    include: { members: { select: { userId: true } } },
  });
  if (!latest)
    return { cycleId: null, teams: 0, confirmed: 0, avgScore: 0, provider: "unknown", trace: [] };

  const end = latest.createdAt.getTime();
  const evalUntil = new Date(end + 2_000);
  const ownerPart = await db.swarmPart.findFirst({
    where: {
      kind: "team_eval",
      teamId: { in: latest.members.map((m) => `h:${m.userId}`) },
      updatedAt: { lte: evalUntil },
    },
    orderBy: { updatedAt: "desc" },
    select: { teamId: true },
  });
  const ownerId = ownerPart?.teamId ? ownerPart.teamId.slice(2) : null;

  const batch = await db.team.findMany({
    where: {
      createdAt: { gte: new Date(end - BATCH_WINDOW_MS), lte: latest.createdAt },
      ...(ownerId ? { members: { some: { userId: ownerId } } } : { id: latest.id }),
    },
    orderBy: { score: "desc" },
    select: { score: true, status: true },
  });
  const teams = batch.length;
  const avgScore = teams ? batch.reduce((s, t) => s + t.score, 0) / teams : 0;
  const confirmed = batch.filter((t) => t.status === "assembled").length;

  const trace: TraceStep[] = [];
  let provider = "unknown";
  if (ownerId) {
    // ① 候選池來源：互盤 run（每場 6 個 pair part）
    const runs = await db.matchRun.findMany({
      where: {
        status: "completed",
        createdAt: { lte: latest.createdAt },
        OR: [{ userAId: ownerId }, { userBId: ownerId }],
      },
      select: { id: true },
    });
    if (runs.length) {
      const parts = await db.swarmPart.findMany({
        where: { runId: { in: runs.map((r) => r.id) } },
        select: { status: true, retries: true, provider: true },
      });
      if (parts.length) {
        const t = tally(parts);
        trace.push({
          step: trace.length + 1,
          stage: "pair_eval",
          cmd: `runPair × ${runs.length} completed pair interviews → ${t.text}`,
          exit: t.failed || t.pending ? 1 : 0,
        });
      }
    }
    // ② 隔離評估：同一輪的 team_eval parts（依完成時間往回分群）
    const evals = await db.swarmPart.findMany({
      where: { kind: "team_eval", teamId: `h:${ownerId}`, updatedAt: { lte: evalUntil } },
      orderBy: { updatedAt: "desc" },
      select: { status: true, retries: true, provider: true, updatedAt: true },
    });
    const cycle: PartRow[] = [];
    let prev = end;
    for (const p of evals) {
      const at = p.updatedAt.getTime();
      if (prev - at > CYCLE_GAP_MS) break;
      cycle.push(p);
      prev = Math.min(prev, at);
    }
    if (cycle.length) {
      const t = tally(cycle);
      provider = t.providers;
      trace.push({
        step: trace.length + 1,
        stage: "team_eval",
        cmd: `assembleTeams → ${cycle.length} squad hypotheses as isolated team_eval parts → ${t.text}`,
        exit: t.failed || t.pending ? 1 : 0,
      });
    }
  }
  // ③ 匯合：硬約束 + 不重疊貪婪，實際寫入的 Team
  trace.push({
    step: trace.length + 1,
    stage: "assembly",
    cmd: `hard constraints + non-overlapping greedy selection → ${teams} squads committed (scores ${batch.map((t) => t.score).join("/")}) · ${confirmed} confirmed by all members`,
    exit: teams > 0 ? 0 : 1,
  });

  return { cycleId: latest.id, teams, confirmed, avgScore, provider, trace };
}

/** 用最新一輪組隊的實際證據組出 Gene + Capsule + EvolutionEvent bundle */
export function buildTeamAssemblyAssets(
  ev: AssemblyEvidence,
): [GeneAsset, CapsuleAsset, EvolutionEventAsset] {
  const score = Math.round(Math.max(0, Math.min(1, ev.avgScore / 100)) * 100) / 100;
  const status: "success" | "failed" = ev.teams > 0 ? "success" : "failed";
  const cycle = ev.cycleId ? ev.cycleId.slice(0, 8) : "none";

  const gene: GeneAsset = {
    type: "Gene",
    schema_version: "1.5.0",
    category: "innovate",
    signals_match: SIGNALS,
    summary:
      "Hypothesis-evaluated swarm team assembly: every candidate pair becomes an isolated three-person squad hypothesis, hard role-gap / deadlock constraints, non-overlapping greedy squad formation with a transparent decision layer (Jev → LLM → rules).",
    strategy: [
      "Enumerate every unordered pair of top candidates as a three-person squad hypothesis (assembler + 2) and evaluate each hypothesis as its own isolated swarm part with one retry",
      "Reject hypotheses scoring below 60 or tripping a hard constraint (role-gap or deadlock probability ≥ 0.6)",
      "Select up to 3 non-overlapping squads greedily by blended score: team evaluation × 0.75 + ledger competence × 0.25",
      "Record which decision tier answered each part (Jev / LLM / local rules) for a fully auditable run",
    ],
    validation: VALIDATION,
    asset_id: "",
  };
  gene.asset_id = computeAssetId(gene as unknown as Record<string, unknown>);

  const blast = repoBlastRadius();
  const capsule: CapsuleAsset = {
    type: "Capsule",
    schema_version: "1.5.0",
    trigger: SIGNALS,
    gene: gene.asset_id,
    summary: ev.cycleId
      ? `Hackathon squad formation cycle ${cycle}: ${ev.teams} squads committed at avg score ${ev.avgScore.toFixed(1)} (decision layer: ${ev.provider}).`
      : "Hackathon squad formation: no squad formation cycle on record yet (0 squads).",
    content: [
      "Intent: assemble balanced hackathon squads (assembler + 2 teammates) from participants whose captain agents already interviewed each other pairwise.",
      "",
      "Strategy:",
      "1. Every unordered pair of top candidates forms a three-person squad hypothesis, evaluated in isolation as its own swarm part (coverage, complement, chemistry, logistics) with one retry.",
      "2. Hard constraints drop unsafe hypotheses (score below 60, role-gap or deadlock probability ≥ 0.6).",
      "3. Non-overlapping greedy selection commits up to 3 squads by blended score (team evaluation × 0.75 + ledger competence × 0.25).",
      "4. The decision layer (Jev → LLM → local rules) answers every part and records which tier answered, so the run is auditable.",
      "",
      `Prior art studied (recall before solving): promoted Capsule ${PRIOR_ART_CAPSULE_ID} (SwarmDecomposer, GDI 41.3 when fetched). We borrowed only its packaging: a self-contained validation command and a code_snippet evidence field. The squad engine is our own and does not use that capsule's code or gene (isolated per-hypothesis evaluation plus ledger blending, not recursive task splitting).`,
      "",
      ev.cycleId
        ? `Outcome (read from the database when this bundle was built): cycle ${cycle}, ${ev.teams} squads committed, average score ${ev.avgScore.toFixed(1)}, ${ev.confirmed} confirmed by all members, decision layer ${ev.provider}. execution_trace lists the recorded MatchRun / SwarmPart / Team results of that cycle, not a re-run.`
        : "Outcome: no squad formation cycle on record yet, so this capsule reports status failed and carries no execution trace.",
    ].join("\n"),
    strategy: [
      "Evaluate each three-person squad hypothesis as an isolated swarm part with one retry",
      "Apply hard constraints (score floor / role gap / deadlock) before selection",
      "Greedy non-overlapping selection of up to 3 squads with an auditable decision layer",
    ],
    confidence: score,
    ...(blast ? { blast_radius: blast } : {}),
    outcome: { status, score },
    env_fingerprint: {
      platform: process.platform,
      arch: process.arch,
      node_version: process.version,
    },
    // success_streak 刻意不放：DB 沒有逐輪的組隊成敗紀錄（0 隊的輪次不留任何列、
    // team_eval part 以穩定 id 覆寫），算不出真正的連勝數。
    validation: VALIDATION,
    code_snippet: [
      "// src/lib/teamAssembler.ts — actual excerpts: blended score, then non-overlapping greedy selection",
      "const blended =",
      '  signalMode === "competence"',
      "    ? Math.round(raw * 0.75 + compAvg * 0.25)",
      "    : raw;",
      "report.score = blended;",
      "",
      "scored.sort((x, y) => y.report.score - x.report.score);",
      "",
      "const picked: typeof scored = [];",
      "const used = new Set<string>();",
      "for (const s of scored) {",
      "  if (picked.length >= 3) break;",
      "  if (used.has(s.hyp.a.userId) || used.has(s.hyp.b.userId)) continue;",
      "  picked.push(s);",
      "  used.add(s.hyp.a.userId);",
      "  used.add(s.hyp.b.userId);",
      "}",
    ].join("\n"),
    ...(ev.trace.length ? { execution_trace: ev.trace } : {}),
    asset_id: "",
  };
  capsule.asset_id = computeAssetId(capsule as unknown as Record<string, unknown>);

  // mutations_tried / total_cycles 為選填，沒有可對應的實測值 → 不放
  const event: EvolutionEventAsset = {
    type: "EvolutionEvent",
    intent: "innovate",
    capsule_id: capsule.asset_id,
    genes_used: [gene.asset_id],
    outcome: { status, score },
    asset_id: "",
  };
  event.asset_id = computeAssetId(event as unknown as Record<string, unknown>);

  return [gene, capsule, event];
}

/** Hub 的 validate 是否真的通過（HTTP 2xx 且回應沒有明示失敗） */
export function validationPassed(res: EvoResult): boolean {
  if (!res.ok) return false;
  const d = (res.data ?? {}) as Record<string, unknown>;
  const p = (d.payload as Record<string, unknown> | undefined) ?? d;
  if (p.valid === false || p.ok === false) return false;
  if (Array.isArray(p.errors) && p.errors.length > 0) return false;
  return true;
}

// ---------- 協定操作 ----------
export function hello(name: string, model: string): Promise<EvoResult> {
  return post("/a2a/hello", {
    protocol: PROTOCOL,
    protocol_version: PROTOCOL_VERSION,
    message_type: "hello",
    message_id: `msg_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    payload: {
      capabilities: { supported_types: ["Gene", "Capsule", "EvolutionEvent"] },
      model,
      name,
      env_fingerprint: {
        platform: process.platform,
        arch: process.arch,
        node_version: process.version,
      },
    },
  });
}

export function validateBundle(assets: unknown[]): Promise<EvoResult> {
  return post("/a2a/validate", envelope("publish", { assets }), { auth: true });
}

export function publishBundle(assets: unknown[]): Promise<EvoResult> {
  return post("/a2a/publish", envelope("publish", { assets }), { auth: true });
}

export function fetchAssets(
  signals: string[],
  searchOnly = true,
): Promise<EvoResult> {
  return post(
    "/a2a/fetch",
    envelope("fetch", { asset_type: "Capsule", signals, search_only: searchOnly }),
    { auth: true },
  );
}

export async function hubStats(): Promise<EvoResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${base()}/a2a/stats`, { signal: ctrl.signal });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    return res.ok ? { ok: true, status: res.status, data } : { ok: false, status: res.status, error: text.slice(0, 200) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

/** hubStats 記憶體快取（同一個 base 60 秒內共用同一次請求；失敗也快取，避免匿名請求一比一轉發到 Hub） */
const HUB_STATS_TTL_MS = 60_000;
const statsCache = globalThis as unknown as {
  __evomapHubStats?: { at: number; base: string; value: Promise<EvoResult> };
};
export function hubStatsCached(ttlMs = HUB_STATS_TTL_MS): Promise<EvoResult> {
  const now = Date.now();
  const b = base();
  const hit = statsCache.__evomapHubStats;
  if (hit && hit.base === b && now - hit.at < ttlMs) return hit.value;
  const value = hubStats();
  statsCache.__evomapHubStats = { at: now, base: b, value };
  return value;
}
