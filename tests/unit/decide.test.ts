import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// 測試不碰網路：所有請求走下面的 mock fetch；就算漏網也只會打到本機不可達位址
process.env.JEV_BASE_URL = "http://127.0.0.1:9";
process.env.LLM_BASE_URL = "http://127.0.0.1:9";
process.env.JEV_API_KEY = "test-key";
process.env.LLM_API_KEY = "";

import {
  CircuitBreaker,
  _resetDecideState,
  decide,
  jevBreaker,
  parseAnswer,
  type DecideAnswer,
  type DecideQuestion,
} from "../../src/lib/llm/decide";

const LEVELS = ["0", "1", "2", "3", "4"]; // score 範圍 0..4
const QUESTIONS: DecideQuestion[] = [
  { id: "s1", type: "score", instructions: "s", criteria: LEVELS },
  { id: "c1", type: "choice", instructions: "c", criteria: { yes: "y", no: "n" } },
  { id: "n1", type: "noul", instructions: "n" },
];
const RULE: Record<string, DecideAnswer> = {
  s1: { id: "s1", type: "score", value: 2, confidence: 1, probabilities: {} },
  c1: { id: "c1", type: "choice", value: "no", confidence: 1, probabilities: {} },
  n1: { id: "n1", type: "noul", value: 0.5 },
};
const fallback = (q: DecideQuestion) => RULE[q.id];

type Handler = (body: { questions: Record<string, unknown> }) => Response | Promise<Response>;
const realFetch = globalThis.fetch;
let calls: { questions: string[] }[] = [];

function mockFetch(handler: Handler) {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ questions: Object.keys(body.questions ?? {}) });
    return handler(body);
  }) as typeof fetch;
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = [];
  _resetDecideState();
  process.env.JEV_TIMEOUT_MS = "2000";
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("parseAnswer：範圍與枚舉驗證", () => {
  const [s, c, n] = QUESTIONS;
  assert.equal(parseAnswer(s, { score: 57 }), null); // 超出 0..4
  assert.equal(parseAnswer(s, { score: -1 }), null);
  assert.equal(parseAnswer(s, { score: "3" }), null);
  assert.deepEqual(parseAnswer(s, { score: 3.5, confidence: 2 }), {
    id: "s1",
    type: "score",
    value: 3.5,
    confidence: 1,
    probabilities: {},
  });
  assert.equal(parseAnswer(c, { choice: "banana", probabilities: {} }), null);
  assert.equal(parseAnswer(c, { choice: "yes" })?.value, "yes");
  assert.equal(parseAnswer(n, { noul: 7 }), null);
  assert.equal(parseAnswer(n, { noul: 1 })?.value, 1);
});

test("逐題 fallback：不合法的題目退回規則，只重打缺漏題並合併", async () => {
  let n = 0;
  mockFetch(() => {
    n++;
    // 第 1 次：s1 合法、c1 不在枚舉、n1 超出範圍；第 2 次（只送缺漏題）：c1 合法、n1 仍缺
    return n === 1
      ? json({ model: "jev-test", answers: { s1: { score: 3 }, c1: { choice: "banana" }, n1: { noul: 7 } } })
      : json({ answers: { c1: { choice: "yes", probabilities: { yes: 0.9 } } } });
  });
  const r = await decide({ state: {}, questions: QUESTIONS, fallback, provider: "jev" });
  assert.equal(r.source, "jev");
  assert.deepEqual(calls.map((c) => c.questions), [["s1", "c1", "n1"], ["c1", "n1"]]);
  assert.equal(r.coverage.remote, 2);
  assert.equal(r.coverage.fallbacks, 1);
  assert.equal(r.coverage.retries, 1);
  assert.deepEqual(r.fallbackIds, ["n1"]);
  assert.equal((r.answers.find((a) => a.id === "s1") as { value: number }).value, 3);
  assert.equal((r.answers.find((a) => a.id === "c1") as { value: string }).value, "yes");
  assert.deepEqual(r.answers.find((a) => a.id === "n1"), RULE.n1);
});

test("第 2 次重打失敗時保留第 1 次的部分答案", async () => {
  let n = 0;
  mockFetch(() => {
    n++;
    if (n === 1) return json({ answers: { s1: { score: 1 } } });
    throw new Error("ECONNRESET");
  });
  const r = await decide({ state: {}, questions: QUESTIONS, fallback, provider: "jev" });
  assert.equal(r.source, "jev");
  assert.equal(r.coverage.remote, 1);
  assert.equal(r.coverage.fallbacks, 2);
  assert.match(r.note ?? "", /jev_partial: ECONNRESET/);
  assert.equal(jevBreaker.consecutiveFailures(), 0); // 有拿到答案＝成功
});

test("遠端一題有效答案都沒有 → source 必須是 mock，不能標 jev", async () => {
  mockFetch(() => json({ answers: { s1: { score: 99 }, c1: { choice: "x" }, n1: { noul: -3 } } }));
  const r = await decide({ state: {}, questions: QUESTIONS, fallback, provider: "jev" });
  assert.equal(r.source, "mock");
  assert.equal(r.coverage.remote, 0);
  assert.equal(r.coverage.fallbacks, 3);
  assert.match(r.note ?? "", /jev_failed: no_valid_answers/);
  assert.deepEqual(r.answers, QUESTIONS.map((q) => RULE[q.id]));
});

test("逾時涵蓋讀 body：標頭回來後 body 卡住也會在時限內退回規則", async () => {
  process.env.JEV_TIMEOUT_MS = "150";
  mockFetch(
    () =>
      new Response(new ReadableStream({ start() {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  const t0 = Date.now();
  const r = await decide({ state: {}, questions: QUESTIONS, fallback, provider: "jev" });
  const ms = Date.now() - t0;
  assert.equal(r.source, "mock");
  assert.match(r.note ?? "", /jev_failed: timeout/);
  assert.ok(ms < 2000, `took ${ms}ms`);
});

test("斷路器：連續 3 次失敗才打開；成功歸零", async () => {
  let fail = true;
  mockFetch(() => (fail ? json({ error: "down" }, 503) : json({ answers: { s1: { score: 1 }, c1: { choice: "no" }, n1: { noul: 0 } } })));
  const run = () => decide({ state: {}, questions: QUESTIONS, fallback, provider: "jev" });

  // fail, ok, fail, ok, fail → 不是「連續」3 次，不能打開
  for (const f of [true, false, true, false, true]) {
    fail = f;
    await run();
  }
  assert.equal(jevBreaker.state(), "closed");
  fail = false;
  const healthy = await run();
  assert.equal(healthy.source, "jev");

  // 連續 3 次失敗 → 打開，第 4 次直接跳過（不送請求）
  fail = true;
  await run();
  await run();
  await run();
  assert.equal(jevBreaker.state(), "open");
  const before = calls.length;
  const skipped = await run();
  assert.equal(calls.length, before);
  assert.equal(skipped.source, "mock");
  assert.match(skipped.note ?? "", /jev_circuit_open/);
});

test("斷路器：冷卻後半開只放一個探測，探測成功才關閉", () => {
  let now = 0;
  const b = new CircuitBreaker({ threshold: 3, cooldownMs: 60_000, now: () => now });
  b.failure();
  b.failure();
  assert.equal(b.acquire(), "closed");
  b.failure();
  assert.equal(b.acquire(), "open");
  now = 59_999;
  assert.equal(b.acquire(), "open");
  now = 60_000;
  assert.equal(b.state(), "half-open");
  assert.equal(b.acquire(), "probe");
  // 探測在飛時，其他並行呼叫一律跳過
  assert.equal(b.acquire(), "open");
  assert.equal(b.acquire(), "open");
  // 探測失敗 → 再冷卻一整輪
  b.failure();
  now = 60_001;
  assert.equal(b.acquire(), "open");
  now = 120_000;
  assert.equal(b.acquire(), "probe");
  b.success();
  assert.equal(b.state(), "closed");
  assert.equal(b.consecutiveFailures(), 0);
  assert.equal(b.acquire(), "closed");
});

test("斷路器：並行呼叫在半開時只有一個真的送出", async () => {
  // 先把全域斷路器打開
  mockFetch(() => json({ error: "down" }, 503));
  for (let i = 0; i < 3; i++)
    await decide({ state: {}, questions: QUESTIONS, fallback, provider: "jev" });
  assert.equal(jevBreaker.state(), "open");
  calls = [];
  // 用可控時鐘模擬冷卻結束：直接換一顆已過冷卻的斷路器狀態
  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  try {
    mockFetch(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return json({ answers: { s1: { score: 1 }, c1: { choice: "no" }, n1: { noul: 0 } } });
    });
    const rs = await Promise.all(
      Array.from({ length: 10 }, () =>
        decide({ state: {}, questions: QUESTIONS, fallback, provider: "jev" }),
      ),
    );
    assert.equal(calls.length, 1);
    assert.equal(rs.filter((r) => r.source === "jev").length, 1);
    assert.equal(jevBreaker.state(), "closed");
  } finally {
    Date.now = realNow;
  }
});
