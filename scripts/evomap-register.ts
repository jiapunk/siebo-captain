import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, hello } from "../src/lib/evomap";

/**
 * EvoMap 節點註冊（opt-in，只有你主動執行時才會連線）
 *   npm run evomap:register              # .env 已有 EVOMAP_NODE_SECRET 就不重註冊
 *   npm run evomap:register -- --force   # 另註冊新節點；舊的 id/secret 先備份到 .env.evomap-backup-<時間>
 * 成功後 node_id / node_secret 寫入本地 .env（gitignore），claim_url 交給本人綁定帳號。
 * node_secret 只會發一次：寫不進 .env 就直接印出並 exit 1，絕不默默丟掉。
 */

/** .env 裡「未註解」的 KEY= 行（逐行錨定，註解行 `# KEY=...` 不算；同名多行時 dotenv 取最後一行） */
function lineRe(key: string, flags: string): RegExp {
  return new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=(.*)$`, flags);
}

/** 取 KEY 的有效值（去引號、去行尾註解）；沒有未註解的行或值為空 → "" */
function envValue(env: string, key: string): string {
  const all = Array.from(env.matchAll(lineRe(key, "gm")));
  if (all.length === 0) return "";
  let v = all[all.length - 1][1].trim();
  const quoted = v.match(/^(['"])(.*)\1/);
  v = quoted ? quoted[2] : v.replace(/\s+#.*$/, "").trim();
  return v;
}

/** 取代所有未註解的 KEY= 行；沒有就附加在檔尾 */
function upsertEnv(env: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  if (lineRe(key, "m").test(env)) return env.replace(lineRe(key, "gm"), () => line);
  return env + (env === "" || env.endsWith("\n") ? "" : "\n") + line + "\n";
}

(async () => {
  const force = process.argv.includes("--force");
  const envPath = join(process.cwd(), ".env");
  const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const oldId = envValue(env, "EVOMAP_NODE_ID");
  const oldSecret = envValue(env, "EVOMAP_NODE_SECRET");

  if (oldSecret && !force) {
    console.log(`[evomap] .env 已有 EVOMAP_NODE_SECRET（節點 ${oldId || "?"}）—— 不重新註冊。`);
    console.log("[evomap] 要另註冊一個新節點請加 --force（舊的 id/secret 會先備份）。");
    process.exit(0);
  }

  const name = process.env.EVOMAP_NODE_NAME ?? "siebo-captain";
  const model = process.env.LLM_MODEL ?? "deepseek-v4.1-flash";
  console.log(`[evomap] hello → ${base()}/a2a/hello （name=${name}）`);
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

  if (!secret) {
    if (oldSecret) {
      console.log("[evomap] 未收到新 secret —— .env 維持原本的節點設定");
      process.exit(0);
    }
    console.error("[evomap] Hub 沒有回傳 node_secret，.env 也沒有 —— 節點無法認證，請稍後重試");
    process.exit(1);
  }

  // 有新的一次性 secret：id 與 secret 必須成對寫入；舊值先備份
  try {
    if (oldId || oldSecret) {
      const backup = `${envPath}.evomap-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      writeFileSync(backup, `EVOMAP_NODE_ID=${oldId}\nEVOMAP_NODE_SECRET=${oldSecret}\n`, { mode: 0o600 });
      console.log(`[evomap] 舊節點設定已備份：${backup}`);
    }
    let next = env;
    if (nodeId) next = upsertEnv(next, "EVOMAP_NODE_ID", nodeId);
    next = upsertEnv(next, "EVOMAP_NODE_SECRET", secret);
    next = upsertEnv(next, "EVOMAP_ENABLED", "1"); // 主動註冊＝明確 opt-in
    writeFileSync(envPath, next, { mode: 0o600 });
    const written = readFileSync(envPath, "utf8");
    if (envValue(written, "EVOMAP_NODE_SECRET") !== secret)
      throw new Error("寫入後讀回的 EVOMAP_NODE_SECRET 不一致");
  } catch (err) {
    console.error(`[evomap] 寫入 .env 失敗：${err instanceof Error ? err.message : err}`);
    console.error("[evomap] node_secret 只會發這一次，請立刻手動存進 .env：");
    if (nodeId) console.error(`EVOMAP_NODE_ID=${nodeId}`);
    console.error(`EVOMAP_NODE_SECRET=${secret}`);
    process.exit(1);
  }
  console.log(
    `[evomap] 已寫入 .env：${nodeId ? "EVOMAP_NODE_ID, " : ""}EVOMAP_NODE_SECRET, EVOMAP_ENABLED=1（node_secret 僅存在本地 .env）`,
  );
  if (!nodeId) console.warn("[evomap] Hub 沒有回傳 node_id —— 請確認 .env 的 EVOMAP_NODE_ID 屬於這把 secret");
})();
