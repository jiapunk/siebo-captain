/**
 * 引擎探針：由 tests/fallback.spec.ts 以子行程（npx tsx）執行，不是 Playwright spec。
 * LLM_MODE 在 import 時就決定，所以「real 模式 + LLM 不通」必須在獨立行程裡跑。
 *
 *   fallback-run <userName>  以 startMatching 跑一輪互盤（呼叫端給 LLM_PROVIDER=real + 黑洞 LLM_BASE_URL），
 *                            等全部 run 結束，印出 run 與逐 Part 軌跡
 *   part-fail                runPartDetailed 沒有退路、fn／validate 永遠失敗 → 印出拋出的錯誤與 SwarmPart 列
 *
 * 輸出：最後一行 `PROBE_RESULT <json>`。
 * 防呆：DATABASE_URL 指向 prisma/dev.db、或 LLM／Jev 端點不是本機迴路時拒絕執行（假金鑰絕不外送）。
 */
import { absoluteDatabaseUrl, databaseUrl, isDevDbUrl } from "../../prisma/db-path";

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;

function refuse(msg: string): never {
  console.error(`[swarm-probe] 拒絕執行：${msg}`);
  process.exit(2);
}

function guard(): void {
  const url = databaseUrl();
  if (isDevDbUrl(url)) refuse(`DATABASE_URL（${url}）指向 prisma/dev.db（demo 資料）`);
  process.env.DATABASE_URL = absoluteDatabaseUrl(url);
  for (const k of ["LLM_BASE_URL", "JEV_BASE_URL"]) {
    const v = process.env[k] ?? "";
    if (!LOOPBACK.test(v)) refuse(`${k}（${v || "未設定"}）必須指向本機迴路位址`);
  }
  if (process.env.EVOMAP_ENABLED === "1") refuse("EVOMAP_ENABLED 必須關閉");
}

function emit(result: unknown): void {
  console.log(`PROBE_RESULT ${JSON.stringify(result)}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fallbackRun(userName: string) {
  const { prisma } = await import("../../src/lib/db");
  const { LLM_MODE } = await import("../../src/lib/llm");
  const { startMatching } = await import("../../src/lib/matching");
  const { partsByRun } = await import("../../src/lib/swarm");
  try {
    const user = await prisma.user.findFirst({ where: { name: userName } });
    if (!user) throw new Error(`user not found: ${userName}`);

    const runIds = await startMatching(user.id, "zh");
    // runPair 在背景跑：輪詢到全部離開 running（real 模式 pace=0，黑洞連線立即被拒，數秒內結束）
    const deadline = Date.now() + 90_000;
    for (;;) {
      const left = await prisma.matchRun.count({
        where: { id: { in: runIds }, status: "running" },
      });
      if (left === 0) break;
      if (Date.now() > deadline) throw new Error(`runs still running after 90s: ${left}`);
      await sleep(250);
    }

    const runs = await prisma.matchRun.findMany({ where: { id: { in: runIds } } });
    const parts = await prisma.swarmPart.findMany({
      where: { runId: { in: runIds } },
      select: { id: true, runId: true, kind: true, status: true, retries: true, provider: true, note: true },
      orderBy: { id: "asc" },
    });
    const summaries = await partsByRun(runIds);
    emit({
      llmMode: LLM_MODE,
      runIds,
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        eventCount: Array.isArray(r.events) ? r.events.length : 0,
        hasReportA: r.reportA !== null,
        hasReportB: r.reportB !== null,
      })),
      parts,
      summaries: Object.fromEntries(summaries),
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function partFail() {
  const { prisma } = await import("../../src/lib/db");
  const { runPartDetailed } = await import("../../src/lib/swarm");
  const stamp = Date.now().toString(36);
  const ids: string[] = [];

  /** 跑一個註定失敗的 Part，回報拋出的錯誤、生命週期、fn 被呼叫次數與最後的 DB 列 */
  async function drill(
    name: string,
    opts: { validateFails?: boolean; fallbackFails?: boolean },
  ) {
    const id = `t:probe-${name}-${stamp}`;
    ids.push(id);
    const phases: string[] = [];
    let fnCalls = 0;
    let fallbackCalls = 0;
    let thrown: string | null = null;
    let resolved = false;
    try {
      await runPartDetailed<string>(
        {
          id,
          kind: "team_eval",
          label: "probe",
          teamId: `h:probe-${stamp}`,
          notify: (e) => phases.push(e.phase),
          validate: opts.validateFails
            ? () => {
                throw new Error("probe_invalid_value");
              }
            : undefined,
          fallback: opts.fallbackFails
            ? async () => {
                fallbackCalls++;
                throw new Error("probe_fallback_fails");
              }
            : undefined,
        },
        async () => {
          fnCalls++;
          if (opts.validateFails) return { value: "looks-ok-but-invalid" };
          throw new Error("probe_always_fails");
        },
      );
      resolved = true;
    } catch (e) {
      thrown = (e as Error)?.message ?? String(e);
    }
    const row = await prisma.swarmPart.findUnique({
      where: { id },
      select: { status: true, retries: true, note: true, kind: true, teamId: true },
    });
    return { name, resolved, thrown, phases, fnCalls, fallbackCalls, row };
  }

  try {
    const results = [
      await drill("nofallback", {}),
      await drill("fallbackfails", { fallbackFails: true }),
      await drill("invalid", { validateFails: true }),
    ];
    emit({ results });
  } finally {
    await prisma.swarmPart.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    await prisma.$disconnect();
  }
}

async function main() {
  guard();
  const [mode, arg] = process.argv.slice(2);
  if (mode === "fallback-run") await fallbackRun(arg || "Demo阿飛");
  else if (mode === "part-fail") await partFail();
  else refuse(`未知模式：${mode ?? "(無)"}`);
}

main().catch((e) => {
  console.error("[swarm-probe]", e);
  process.exit(1);
});
