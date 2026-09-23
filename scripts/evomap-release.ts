import "dotenv/config";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  PRIOR_ART_CAPSULE_ID,
  buildTeamAssemblyAssets,
  collectAssemblyEvidence,
  enabled,
  linked,
  publishBundle,
  validateBundle,
  validationPassed,
} from "../src/lib/evomap";

/**
 * 把最新一輪組隊成果發佈成 EvoMap Gene+Capsule+EvolutionEvent bundle（opt-in）
 *   npm run evomap:release                 # validate 通過才 publish
 *   npm run evomap:release -- --dry-run    # 只從 DB 組 bundle 並印出，不連線
 *   npm run evomap:release -- --force      # validate 沒過 / 0 隊也照樣 publish（自負風險）
 * Capsule 的 outcome / execution_trace 全部由 DB 實際紀錄計算（見 collectAssemblyEvidence）。
 */
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

/** 確認 Capsule 文字引用的前例資產在本地有存檔（assets/gep/learned/） */
function priorArtNote(): string {
  const file = join(
    process.cwd(),
    "assets/gep/learned",
    `sha256_${PRIOR_ART_CAPSULE_ID.slice(7, 15)}.json`,
  );
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as { asset_id?: string };
    return saved.asset_id === PRIOR_ART_CAPSULE_ID
      ? `${PRIOR_ART_CAPSULE_ID.slice(0, 23)}…（本地存檔相符）`
      : `⚠ 本地存檔的 asset_id 與引用不符（${file}）`;
  } catch {
    return `⚠ 找不到本地存檔 ${file}`;
  }
}

async function main(prisma: PrismaClient): Promise<number> {
  const ev = await collectAssemblyEvidence(prisma);
  const assets = buildTeamAssemblyAssets(ev);
  const [gene, capsule, event] = assets;
  console.log(
    `[evomap] bundle: gene ${gene.asset_id.slice(0, 23)}… / capsule ${capsule.asset_id.slice(0, 23)}… / event ${event.asset_id.slice(0, 23)}…`,
  );
  console.log(
    `[evomap] cycle=${ev.cycleId?.slice(0, 8) ?? "none"} teams=${ev.teams} confirmed=${ev.confirmed} avg=${ev.avgScore.toFixed(1)} provider=${ev.provider} outcome=${capsule.outcome.status}`,
  );
  for (const s of capsule.execution_trace ?? [])
    console.log(`[evomap] trace ${s.step} ${s.stage} exit=${s.exit} · ${s.cmd}`);
  if (!capsule.execution_trace) console.log("[evomap] trace（DB 沒有可用紀錄，欄位省略）");
  console.log(`[evomap] prior art: ${priorArtNote()}`);

  if (dryRun) {
    console.log(JSON.stringify(assets, null, 2));
    console.log("[evomap] --dry-run：未連線 Hub");
    return 0;
  }
  if (!enabled() || !linked()) {
    console.error("[evomap] 未啟用或未連結（EVOMAP_ENABLED=1 且需 EVOMAP_NODE_ID / EVOMAP_NODE_SECRET）——不發佈");
    return 1;
  }
  if (ev.teams === 0 && !force) {
    console.error("[evomap] 最新一輪沒有任何隊伍（outcome=failed）——不發佈；確定要發佈請加 --force");
    return 1;
  }

  const val = await validateBundle(assets);
  const passed = validationPassed(val);
  console.log("[evomap] validate:", passed ? "OK" : `FAIL(${val.status ?? "network"})`, passed ? "" : val.error ?? "");
  if (!passed) {
    if (val.data) console.log("[evomap] validate 回應:", JSON.stringify(val.data).slice(0, 400));
    if (!force) {
      console.error("[evomap] validate 沒通過 —— 不發佈（確定要發佈請加 --force）");
      return 1;
    }
    console.warn("[evomap] --force：validate 沒通過仍繼續發佈");
  }

  const pub = await publishBundle(assets);
  if (!pub.ok) {
    console.log(`[evomap] publish FAIL(${pub.status}):`, pub.error);
    if (pub.data) console.log("[evomap] 回應:", JSON.stringify(pub.data).slice(0, 400));
    return 1;
  }
  const d = (pub.data ?? {}) as Record<string, unknown>;
  const payload = (d.payload as Record<string, unknown> | undefined) ?? d;
  console.log("[evomap] publish OK:", JSON.stringify(payload).slice(0, 400));
  // 記下最後一次發佈，供 evomap:status 查詢（公開查詢用 sha256 asset id，不是 bundle id）
  const dir = join(process.cwd(), "assets/gep");
  mkdirSync(dir, { recursive: true });
  const at = new Date().toISOString();
  writeFileSync(
    join(dir, "last-publish.json"),
    JSON.stringify(
      {
        bundleId: payload.bundle_id ?? null,
        assetIds: payload.asset_ids ?? [],
        decision: payload.decision ?? null,
        reason: payload.reason ?? null,
        publishedAt: at,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("[evomap] 已記下 assets/gep/last-publish.json");
  const hist = join(dir, "publish-history.jsonl");
  const prev = existsSync(hist) ? readFileSync(hist, "utf8") : "";
  appendFileSync(
    hist,
    (prev && !prev.endsWith("\n") ? "\n" : "") +
      JSON.stringify({
        bundleId: payload.bundle_id ?? null,
        assetIds: payload.asset_ids ?? [gene.asset_id, capsule.asset_id, event.asset_id],
        decision: payload.decision ?? null,
        outcome: capsule.outcome.status,
        avgScore: ev.avgScore,
        teams: ev.teams,
        validated: passed,
        forced: force,
        at,
      }) +
      "\n",
  );
  return 0;
}

(async () => {
  const prisma = new PrismaClient();
  let code = 1;
  try {
    code = await main(prisma);
  } catch (err) {
    console.error("[evomap] release 失敗:", err instanceof Error ? err.message : err);
  } finally {
    await prisma.$disconnect();
  }
  process.exit(code);
})();
