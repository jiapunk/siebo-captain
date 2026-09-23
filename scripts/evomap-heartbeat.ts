import "dotenv/config";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { base, linked, nodeId } from "../src/lib/evomap";

/**
 * EvoMap 心跳：hello（認證探測）讓節點維持 online / alive
 *   npm run evomap:heartbeat        # 常駐，預設每 5 分鐘
 *   npm run evomap:heartbeat -- --once [--log=<path>]
 * 長駐用 launchd：scripts/evomap-heartbeat-install.sh 由範本 scripts/com.siebo.evomap.heartbeat.plist 產生。
 *
 * 截止：EVOMAP_HEARTBEAT_UNTIL（未設定則用 EVENT_ENDS_AT；都沒設＝不限期）。
 *   過了截止時間就不再帶 node_secret 打 Hub，印出移除排程的指令並 exit 0。
 * --log=<path>（或 EVOMAP_HEARTBEAT_LOG）：該檔超過 1MB 時先原地截斷，只留最後 256KB。
 */

const INTERVAL_MS = Number(process.env.EVOMAP_HEARTBEAT_MS ?? 300_000);
const LABEL = "com.siebo.evomap.heartbeat";
const LOG_MAX_BYTES = 1024 * 1024;
const LOG_KEEP_BYTES = 256 * 1024;

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
const LOG_PATH = argValue("log") ?? process.env.EVOMAP_HEARTBEAT_LOG ?? "";

/** 原地截斷（同一個 inode）：launchd / shell 以 append 開著的 fd 之後會接著寫在新結尾 */
function truncateLog(): void {
  if (!LOG_PATH) return;
  try {
    if (statSync(LOG_PATH).size <= LOG_MAX_BYTES) return;
    const buf = readFileSync(LOG_PATH);
    let tail = buf.subarray(buf.length - LOG_KEEP_BYTES);
    const nl = tail.indexOf(0x0a);
    if (nl >= 0) tail = tail.subarray(nl + 1);
    const note = `[${new Date().toISOString()}] heartbeat log 超過 1MB，已截斷，只保留最後 ${tail.length} bytes\n`;
    writeFileSync(LOG_PATH, Buffer.concat([Buffer.from(note), tail]));
  } catch {
    // log 不存在或無法寫入：不影響心跳
  }
}

/** 截止時間；設定值不是合法時間 → invalid */
function deadline(): { at: number | null; raw: string; key: string; invalid: boolean } {
  const key = process.env.EVOMAP_HEARTBEAT_UNTIL ? "EVOMAP_HEARTBEAT_UNTIL" : "EVENT_ENDS_AT";
  const raw = (process.env[key] ?? "").trim();
  if (!raw) return { at: null, raw, key, invalid: false };
  const at = new Date(raw).getTime();
  return { at: Number.isFinite(at) ? at : null, raw, key, invalid: !Number.isFinite(at) };
}

/** 已過截止時間 → 印提示並回 true */
function expired(): boolean {
  const d = deadline();
  if (d.at === null || Date.now() < d.at) return false;
  console.log(
    [
      `[${new Date().toISOString()}] heartbeat 已停止：已超過 ${d.key}=${d.raw}，不再連線 Hub。`,
      "  若這是 launchd 排程，請移除（之後就不會每 5 分鐘被叫起）：",
      `    launchctl unload ~/Library/LaunchAgents/${LABEL}.plist`,
      `    （或 launchctl bootout gui/$(id -u)/${LABEL}；要延長請改 EVOMAP_HEARTBEAT_UNTIL）`,
    ].join("\n"),
  );
  return true;
}

async function beat(): Promise<boolean> {
  const secret = process.env.EVOMAP_NODE_SECRET ?? "";
  const id = nodeId();
  try {
    const res = await fetch(`${base()}/a2a/hello`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({
        protocol: "gep-a2a",
        protocol_version: "1.0.0",
        message_type: "hello",
        message_id: `msg_hb_${Date.now()}`,
        sender_id: id,
        timestamp: new Date().toISOString(),
        payload: {},
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let payload: Record<string, unknown> = {};
    try {
      const d = JSON.parse(text) as Record<string, unknown>;
      payload = (d.payload as Record<string, unknown> | undefined) ?? d;
    } catch {
      // 非 JSON 回應
    }
    const ok = res.ok && payload.status === "acknowledged";
    const at = new Date().toISOString();
    console.log(
      `[${at}] heartbeat ${ok ? "OK" : `FAIL(${res.status})`} · survival=${payload.survival_status ?? "?"} · credits=${payload.credit_balance ?? "?"}`,
    );
    return ok;
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] heartbeat ERROR: ${err instanceof Error ? err.message : "network"}`,
    );
    return false;
  }
}

(async () => {
  truncateLog();
  const d = deadline();
  if (d.invalid) {
    console.error(`[evomap] heartbeat 略過：${d.key}=${d.raw} 不是合法時間（例 2026-09-25T00:00:00+08:00）`);
    process.exit(1);
  }
  if (expired()) process.exit(0);
  if (process.env.EVOMAP_ENABLED !== "1" || !linked()) {
    console.log("[evomap] heartbeat 略過：未啟用或未連結（EVOMAP_ENABLED / EVOMAP_NODE_SECRET）");
    process.exit(0);
  }
  const once = process.argv.includes("--once");
  if (once) {
    process.exit((await beat()) ? 0 : 1);
  }
  console.log(
    `[evomap] heartbeat 常駐：每 ${INTERVAL_MS / 1000}s${d.at !== null ? `，到 ${d.raw} 為止` : ""}（Ctrl+C 停止）`,
  );
  await beat();
  setInterval(async () => {
    truncateLog();
    if (expired()) process.exit(0);
    await beat();
  }, INTERVAL_MS);
})();
