import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildTeamAssemblyAssets, publishBundle, validateBundle } from "../src/lib/evomap";

/**
 * 把最新組隊成果發佈成 EvoMap Gene+Capsule bundle（opt-in）
 *   npm run evomap:release
 */
(async () => {
  const prisma = new PrismaClient();
  const [run, teams] = await Promise.all([
    prisma.matchRun.findFirst({
      where: { status: "completed" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.team.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const avgScore = teams.length
    ? teams.reduce((s, t) => s + t.score, 0) / teams.length
    : 0;
  const provider =
    (run?.reportA as { decisionSource?: string } | null)?.decisionSource ?? "unknown";
  const assets = buildTeamAssemblyAssets({
    teams: teams.length,
    avgScore,
    provider,
    runId: run?.id ?? "no-run",
  });
  const [gene, capsule, event] = assets;
  console.log(`[evomap] bundle: gene ${gene.asset_id.slice(0, 23)}… / capsule ${capsule.asset_id.slice(0, 23)}…`);
  console.log(`[evomap] teams=${teams.length} avg=${avgScore.toFixed(1)} provider=${provider}`);

  const val = await validateBundle(assets);
  console.log("[evomap] validate:", val.ok ? "OK" : `FAIL(${val.status})`, val.ok ? "" : val.error);
  if (!val.ok && val.status && val.status >= 400 && val.status < 500) {
    console.log("[evomap] validate 回應:", JSON.stringify(val.data).slice(0, 400));
  }

  const pub = await publishBundle(assets);
  if (pub.ok) {
    const d = (pub.data ?? {}) as Record<string, unknown>;
    const payload = (d.payload as Record<string, unknown> | undefined) ?? d;
    console.log("[evomap] publish OK:", JSON.stringify(payload).slice(0, 400));
    // 記下最後一次發佈，供 evomap:status 查詢
    const dir = join(process.cwd(), "assets/gep");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "last-publish.json"),
      JSON.stringify(
        {
          bundleId: payload.bundle_id ?? null,
          assetIds: payload.asset_ids ?? [],
          decision: payload.decision ?? null,
          reason: payload.reason ?? null,
          publishedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(`[evomap] 已記下 assets/gep/last-publish.json`);
    const hist = join(dir, "publish-history.jsonl");
    writeFileSync(
      hist,
      (existsSync(hist) ? readFileSync(hist, "utf8") : "") +
        JSON.stringify({
          bundleId: payload.bundle_id ?? null,
          decision: payload.decision ?? null,
          avgScore,
          teams: teams.length,
          at: new Date().toISOString(),
        }) +
        "\n",
    );
  } else {
    console.log(`[evomap] publish FAIL(${pub.status}):`, pub.error);
    if (pub.data) console.log("[evomap] 回應:", JSON.stringify(pub.data).slice(0, 400));
  }
  await prisma.$disconnect();
})();
