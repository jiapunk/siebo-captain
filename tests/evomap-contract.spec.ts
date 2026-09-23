import { createHash } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import {
  buildTeamAssemblyAssets,
  fetchAssets,
  hello,
  publishBundle,
  validateBundle,
  validationPassed,
  type AssemblyEvidence,
} from "../src/lib/evomap";

/**
 * EvoMap 協定契約（src/lib/evomap.ts）：不打真 Hub。
 * - 資產：outcome / execution_trace 由傳入的證據決定；0 隊 → failed；success_streak 一律不放；
 *   asset_id = "sha256:" + sha256(鍵排序 canonical JSON，去掉 asset_id 本身)，這裡用獨立實作重算
 * - 封包：EVOMAP_BASE 指到本機 stub，逐一檢查 hello / validate / publish / fetch 的路徑、封包欄位、Bearer
 * 不需要瀏覽器；在 Playwright worker 內直接 import 模組執行。
 */

// ---- 獨立的 canonical JSON（不 import 被測的 canonicalJson，避免同一份實作自己驗自己） ----
function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
    .join(",")}}`;
}
function expectedAssetId(asset: Record<string, unknown>): string {
  const rest = { ...asset };
  delete rest.asset_id;
  return `sha256:${createHash("sha256").update(canon(rest), "utf8").digest("hex")}`;
}
function expectContentAddressed(asset: Record<string, unknown>, label: string) {
  expect(asset.asset_id, `${label} asset_id`).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(asset.asset_id, `${label} asset_id 應等於 sha256(canonical JSON)`).toBe(
    expectedAssetId(asset),
  );
}

test.describe("EvoMap 資產組裝", () => {
  test("0 隊：Capsule/Event outcome=failed、沒有 success_streak 與 execution_trace", () => {
    const ev: AssemblyEvidence = {
      cycleId: null,
      teams: 0,
      confirmed: 0,
      avgScore: 0,
      provider: "unknown",
      trace: [],
    };
    const [gene, capsule, event] = buildTeamAssemblyAssets(ev);

    expect(capsule.outcome).toEqual({ status: "failed", score: 0 });
    expect(event.outcome).toEqual({ status: "failed", score: 0 });
    expect(capsule).not.toHaveProperty("success_streak");
    // 空 trace 不放（不以假步驟充數）
    expect(capsule).not.toHaveProperty("execution_trace");
    expect(capsule.summary).toMatch(/0 squads/);

    // 連結關係與內容定址
    expect(capsule.gene).toBe(gene.asset_id);
    expect(event.capsule_id).toBe(capsule.asset_id);
    expect(event.genes_used).toEqual([gene.asset_id]);
    expectContentAddressed(gene as unknown as Record<string, unknown>, "Gene");
    expectContentAddressed(capsule as unknown as Record<string, unknown>, "Capsule");
    expectContentAddressed(event as unknown as Record<string, unknown>, "EvolutionEvent");

    // 0 隊但有紀錄（例如 run 都完成、組隊沒選出任何隊）：仍是 failed，trace 原樣帶入、不補不改
    const failedTrace = [
      { step: 1, stage: "pair_eval", cmd: "runPair × 2 completed pair interviews → 12/12 parts done", exit: 0 },
      { step: 2, stage: "assembly", cmd: "0 squads committed", exit: 1 },
    ];
    const [, capsule0, event0] = buildTeamAssemblyAssets({ ...ev, trace: failedTrace });
    expect(capsule0.outcome).toEqual({ status: "failed", score: 0 });
    expect(event0.outcome).toEqual({ status: "failed", score: 0 });
    expect(capsule0.execution_trace).toEqual(failedTrace);
    expect(capsule0).not.toHaveProperty("success_streak");
    expectContentAddressed(capsule0 as unknown as Record<string, unknown>, "Capsule(0 隊＋trace)");
  });

  test("有隊伍：outcome=success、分數 0–1、execution_trace 原樣帶入、仍無 success_streak", () => {
    const trace = [
      { step: 1, stage: "pair_eval", cmd: "runPair × 5 completed pair interviews → 30/30 parts done", exit: 0 },
      { step: 2, stage: "team_eval", cmd: "assembleTeams → 6 squad hypotheses", exit: 0 },
      { step: 3, stage: "assembly", cmd: "2 squads committed (scores 81/74)", exit: 0 },
    ];
    const ev: AssemblyEvidence = {
      cycleId: "cyc12345-abcdef",
      teams: 2,
      confirmed: 1,
      avgScore: 77.5,
      provider: "mock",
      trace,
    };
    const [gene, capsule, event] = buildTeamAssemblyAssets(ev);

    expect(capsule.outcome).toEqual({ status: "success", score: 0.78 });
    expect(event.outcome).toEqual({ status: "success", score: 0.78 });
    expect(capsule.confidence).toBe(0.78);
    expect(capsule.execution_trace).toEqual(trace);
    expect(capsule).not.toHaveProperty("success_streak");
    expect(capsule.summary).toContain("cycle cyc12345");
    expect(capsule.summary).toContain("2 squads");

    expectContentAddressed(gene as unknown as Record<string, unknown>, "Gene");
    expectContentAddressed(capsule as unknown as Record<string, unknown>, "Capsule");
    expectContentAddressed(event as unknown as Record<string, unknown>, "EvolutionEvent");

    // 內容定址對證據敏感：換一個 trace，Capsule 與 Event 的 id 都要跟著變，Gene 不變
    const [gene2, capsule2, event2] = buildTeamAssemblyAssets({ ...ev, trace: trace.slice(0, 2) });
    expect(gene2.asset_id).toBe(gene.asset_id);
    expect(capsule2.asset_id).not.toBe(capsule.asset_id);
    expect(event2.asset_id).not.toBe(event.asset_id);
  });
});

// ---- 本機 stub Hub ----
interface Captured {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

const ENV_KEYS = ["EVOMAP_BASE", "EVOMAP_NODE_ID", "EVOMAP_NODE_SECRET"] as const;

test.describe("EvoMap 封包（本機 stub，不外連）", () => {
  let server: Server;
  let captured: Captured[] = [];
  /** 下一個請求要回的內容（預設 200 + valid:true） */
  let reply: { status: number; body: unknown } = { status: 200, body: { payload: { valid: true } } };
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          body = { __unparsable: raw };
        }
        captured.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers, body });
        res.writeHead(reply.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    // 結尾多一個斜線：base() 應該把它去掉，路徑不會變成 //a2a/...
    process.env.EVOMAP_BASE = `http://127.0.0.1:${port}/`;
    process.env.EVOMAP_NODE_ID = "node_contract_test";
    process.env.EVOMAP_NODE_SECRET = "contract-test-secret"; // 假值，只送到本機 stub
  });

  test.afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  test.beforeEach(() => {
    captured = [];
    reply = { status: 200, body: { payload: { valid: true } } };
  });

  function expectEnvelope(c: Captured, messageType: string) {
    expect(c.method).toBe("POST");
    expect(c.headers["content-type"]).toMatch(/^application\/json/);
    expect(c.body.protocol).toBe("gep-a2a");
    expect(c.body.protocol_version).toBe("1.0.0");
    expect(c.body.message_type).toBe(messageType);
    expect(c.body.message_id).toMatch(/^msg_\d+_[0-9a-f]+$/);
    expect(typeof c.body.timestamp).toBe("string");
    expect(new Date(c.body.timestamp as string).toISOString()).toBe(c.body.timestamp);
    expect(typeof c.body.payload).toBe("object");
  }

  test("validate / publish：路徑、封包、Bearer、資產原樣且內容定址", async () => {
    const assets = buildTeamAssemblyAssets({
      cycleId: "cycle-stub",
      teams: 1,
      confirmed: 0,
      avgScore: 70,
      provider: "mock",
      trace: [{ step: 1, stage: "assembly", cmd: "1 squad committed", exit: 0 }],
    });

    const v = await validateBundle(assets);
    expect(v).toMatchObject({ ok: true, status: 200 });
    expect(validationPassed(v)).toBe(true);
    const p = await publishBundle(assets);
    expect(p).toMatchObject({ ok: true, status: 200 });

    expect(captured.map((c) => c.path)).toEqual(["/a2a/validate", "/a2a/publish"]);
    const ids = new Set<string>();
    for (const c of captured) {
      // validate 與 publish 共用 publish 封包
      expectEnvelope(c, "publish");
      expect(c.body.sender_id).toBe("node_contract_test");
      expect(c.headers.authorization).toBe("Bearer contract-test-secret");
      const sent = (c.body.payload as { assets: Record<string, unknown>[] }).assets;
      expect(sent).toEqual(JSON.parse(JSON.stringify(assets)));
      expect(sent.map((a) => a.type)).toEqual(["Gene", "Capsule", "EvolutionEvent"]);
      for (const a of sent) expectContentAddressed(a, `${c.path} ${String(a.type)}`);
      ids.add(c.body.message_id as string);
    }
    expect(ids.size, "每個請求的 message_id 都不同").toBe(2);
  });

  test("hello 不帶 Bearer；fetch 帶 Bearer 且預設 search_only", async () => {
    await hello("siebo-captain", "contract-model");
    await fetchAssets(["hackathon_teaming"]);
    expect(captured.map((c) => c.path)).toEqual(["/a2a/hello", "/a2a/fetch"]);

    const [h, f] = captured;
    expectEnvelope(h, "hello");
    expect(h.headers.authorization).toBeUndefined();
    expect(h.body.payload).toMatchObject({
      name: "siebo-captain",
      model: "contract-model",
      capabilities: { supported_types: ["Gene", "Capsule", "EvolutionEvent"] },
    });

    expectEnvelope(f, "fetch");
    expect(f.headers.authorization).toBe("Bearer contract-test-secret");
    expect(f.body.payload).toEqual({
      asset_type: "Capsule",
      signals: ["hackathon_teaming"],
      search_only: true,
    });
  });

  test("沒有 node secret 就不送 Authorization；Hub 回失敗時 validationPassed=false", async () => {
    const secret = process.env.EVOMAP_NODE_SECRET;
    delete process.env.EVOMAP_NODE_SECRET;
    try {
      await validateBundle([]);
      expect(captured[0].path).toBe("/a2a/validate");
      expect(captured[0].headers.authorization).toBeUndefined();
    } finally {
      process.env.EVOMAP_NODE_SECRET = secret;
    }

    // HTTP 200 但明示不合格
    reply = { status: 200, body: { payload: { valid: false } } };
    expect(validationPassed(await validateBundle([]))).toBe(false);
    reply = { status: 200, body: { errors: ["schema_version mismatch"] } };
    expect(validationPassed(await validateBundle([]))).toBe(false);
    // HTTP 錯誤：ok=false、帶 status 與錯誤內文
    reply = { status: 422, body: { error: "bad bundle" } };
    const bad = await validateBundle([]);
    expect(bad).toMatchObject({ ok: false, status: 422 });
    expect(bad.error).toContain("bad bundle");
    expect(validationPassed(bad)).toBe(false);
  });
});
