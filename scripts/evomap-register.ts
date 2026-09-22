import "dotenv/config";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { hello } from "../src/lib/evomap";

/**
 * EvoMap 節點註冊（opt-in，只有你主動執行時才會連線）
 *   npm run evomap:register
 * 成功後 node_secret 會寫入本地 .env（gitignore），claim_url 交給本人綁定帳號。
 */
(async () => {
  const name = process.env.EVOMAP_NODE_NAME ?? "siebo-captain";
  const model = process.env.LLM_MODEL ?? "deepseek-v4.1-flash";
  console.log(`[evomap] hello → https://evomap.ai/a2a/hello （name=${name}）`);
  const res = await hello(name, model);
  const data = (res.data ?? {}) as Record<string, unknown>;
  const payload = (data.payload as Record<string, unknown> | undefined) ?? data;

  if (!res.ok) {
    console.error("[evomap] hello failed:", res.status, res.error);
    process.exit(1);
  }

  const nodeId = String(payload.your_node_id ?? payload.node_id ?? "");
  const secret = String(payload.node_secret ?? "");
  const claimUrl = String(payload.claim_url ?? "");
  const claimCode = String(payload.claim_code ?? "");
  console.log("[evomap] status:", payload.status);
  console.log("[evomap] node:", nodeId || "(none)");
  if (claimUrl) console.log(`[evomap] 綁定帳號（給本人）：${claimUrl}（代碼 ${claimCode}）`);

  const envPath = join(process.cwd(), ".env");
  const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const lines: string[] = [];
  if (nodeId && !env.includes("EVOMAP_NODE_ID=")) lines.push(`EVOMAP_NODE_ID=${nodeId}`);
  if (secret && !env.includes("EVOMAP_NODE_SECRET="))
    lines.push(`EVOMAP_NODE_SECRET=${secret}`);
  if (!env.includes("EVOMAP_ENABLED=")) lines.push("EVOMAP_ENABLED=1");
  if (lines.length) {
    appendFileSync(envPath, (env.endsWith("\n") || env === "" ? "" : "\n") + lines.join("\n") + "\n");
    console.log(`[evomap] 已寫入 .env：${lines.map((l) => l.split("=")[0]).join(", ")}`);
  } else {
    console.log("[evomap] .env 已含節點資訊（略過寫入）");
  }
  if (secret) console.log("[evomap] node_secret 已取得（僅存在本地 .env）");
  else console.log("[evomap] 未收到新 secret —— 節點已註冊過，沿用既有 secret");
})();
