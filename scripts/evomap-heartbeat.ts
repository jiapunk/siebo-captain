import "dotenv/config";
import { base, linked, nodeId } from "../src/lib/evomap";

/**
 * EvoMap 心跳：hello（認證探測）讓節點維持 online / alive
 *   npm run evomap:heartbeat        # 常駐，預設每 5 分鐘
 *   npm run evomap:heartbeat -- --once
 * 可用 launchd（見 scripts/com.siebo.evomap.heartbeat.plist）長駐。
 */

const INTERVAL_MS = Number(process.env.EVOMAP_HEARTBEAT_MS ?? 300_000);

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
  if (process.env.EVOMAP_ENABLED !== "1" || !linked()) {
    console.log("[evomap] heartbeat 略過：未啟用或未連結（EVOMAP_ENABLED / EVOMAP_NODE_SECRET）");
    process.exit(0);
  }
  const once = process.argv.includes("--once");
  if (once) {
    process.exit((await beat()) ? 0 : 1);
  }
  console.log(`[evomap] heartbeat 常駐：每 ${INTERVAL_MS / 1000}s（Ctrl+C 停止）`);
  await beat();
  setInterval(beat, INTERVAL_MS);
})();
