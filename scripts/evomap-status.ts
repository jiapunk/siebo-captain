import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { base, fetchAssets, linked, nodeId } from "../src/lib/evomap";

/**
 * EvoMap 節點狀態總覽（opt-in；hello 同時作為心跳）
 *   npm run evomap:status
 */

async function jsonFetch(
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(18)} ${String(value ?? "—")}`);
}

(async () => {
  if (process.env.EVOMAP_ENABLED !== "1" || !linked()) {
    console.log("[evomap] 未啟用或未連結 —— 先跑 npm run evomap:register（EVOMAP_ENABLED=1）");
    process.exit(0);
  }
  const secret = process.env.EVOMAP_NODE_SECRET ?? "";
  const id = nodeId();
  const auth = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };

  // 1) hello＝認證探測（Hub 會把節點標記為 online，等同一次心跳）
  const hello = await jsonFetch(`${base()}/a2a/hello`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      protocol: "gep-a2a",
      protocol_version: "1.0.0",
      message_type: "hello",
      message_id: `msg_status_${Date.now()}`,
      sender_id: id,
      timestamp: new Date().toISOString(),
      payload: {},
    }),
  });
  const hp = (hello.payload as Record<string, unknown> | undefined) ?? hello;
  console.log("── NODE ─────────────────────────────");
  line("node_id", hp.your_node_id ?? id);
  line("status", hp.status);
  line("claimed", hp.claimed);
  line("survival", hp.survival_status);
  line("credits", hp.credit_balance);
  const cap = hp.capability_profile as Record<string, unknown> | undefined;
  if (cap) line("level / rep", `${cap.level} / ${cap.reputation}`);

  // 2) 節點檔案
  const profile = await jsonFetch(`${base()}/a2a/nodes/${id}`);
  const pp = (profile.payload as Record<string, unknown> | undefined) ?? profile;
  console.log("── PROFILE ──────────────────────────");
  line("reputation", pp.reputation_score);
  line("reuse_total", pp.reuse_total);
  line("strikes", pp.quarantine_strikes);
  line("cooldown", pp.publish_cooldown_until ?? "none");
  line("alias", pp.alias);
  line("last_seen", pp.last_seen_at);

  // 3) 上次發佈的 bundle 狀態（本地紀錄 + Hub 查詢）
  const lastPath = join(process.cwd(), "assets/gep/last-publish.json");
  console.log("── LAST PUBLISH ─────────────────────");
  if (existsSync(lastPath)) {
    const last = JSON.parse(readFileSync(lastPath, "utf8")) as {
      bundleId?: string;
      assetIds?: string[];
      decision?: string;
      publishedAt?: string;
    };
    line("bundle", last.bundleId);
    line("decision", last.decision);
    line("published", last.publishedAt);
    for (const aid of (last.assetIds ?? []).slice(0, 3)) {
      const a = await jsonFetch(`${base()}/a2a/assets/${aid}`);
      const ap = (a.payload as Record<string, unknown> | undefined) ?? a;
      const asset =
        (ap.asset as Record<string, unknown> | undefined) ??
        ((ap.assets as Record<string, unknown>[] | undefined)?.[0] ?? ap);
      const type = (asset.type as string) ?? "?";
      const status = (asset.status as string) ?? "pending review";
      line(type, `${String(aid).slice(0, 22)}… · ${status}`);
    }
  } else {
    console.log("  （尚無紀錄——先跑 npm run evomap:release）");
  }

  // 4) 網路搜尋（search_only 免費）：我們領域有哪些可學的資產
  const fetch = await fetchAssets([
    "hackathon_teaming",
    "team_formation",
    "swarm",
  ]);
  const fp = (((fetch.data ?? {}) as Record<string, unknown>).payload ??
    fetch.data ??
    {}) as Record<string, unknown>;
  const results = (fp.results as Record<string, unknown>[] | undefined) ?? [];
  console.log("── NETWORK (search_only 免費) ───────");
  line("related assets", results.length);
  for (const r of results.slice(0, 4)) {
    const mine = r.source_node_id === id;
    line(
      mine ? "· mine" : "· peer",
      `gdi ${r.gdi_score ?? "?"} · confidence ${r.confidence ?? "?"} · ${String(r.trigger_text ?? "").slice(0, 60)}`,
    );
  }

  // 5) 開放任務（可賺 credit）
  const tasks = await jsonFetch(
    `${base()}/a2a/task/list?limit=5`,
    { headers: auth },
  );
  const tp = (tasks.payload as Record<string, unknown> | undefined) ?? tasks;
  const list = (tp.tasks as Record<string, unknown>[] | undefined) ?? [];
  console.log("── TASKS ────────────────────────────");
  line("open tasks", list.length || tp.count || 0);
  for (const t of list.slice(0, 4)) {
    line(
      "·",
      `${String(t.title ?? t.summary ?? t.id ?? "").slice(0, 60)}${t.bounty ? ` (bounty ${t.bounty})` : ""}`,
    );
  }
  console.log("\n提示：hello 同時是心跳（建議 5 分鐘一次）；GDI 會隨 reuse / success_streak 提升，資產經審核後由 candidate → promoted。");
})();
