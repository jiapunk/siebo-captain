import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// 走真路徑（不是 GITHUB_VERIFY=mock），但 fetch 一律 stub，不連網
delete process.env.GITHUB_VERIFY;
delete process.env.GITHUB_TOKEN;

import { GithubVerifyError, verifyGithub } from "../../src/lib/github";

type Reply = { status?: number; headers?: Record<string, string>; body?: string } | Error;
const realFetch = globalThis.fetch;
let calls: string[] = [];

/** 依序回應每個請求（第 1 個＝/users/:name，第 2 個＝/repos） */
function stubFetch(...replies: Reply[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const r = replies[calls.length - 1];
    if (!r) throw new Error(`unexpected request #${calls.length}: ${String(input)}`);
    if (r instanceof Error) throw r;
    return new Response(r.body ?? "{}", { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
}

const user = { body: JSON.stringify({ login: "Octo", public_repos: 7, created_at: "2020-01-01T00:00:00Z" }) };

async function expectCode(code: string, retryAfterSec?: number) {
  await assert.rejects(verifyGithub("octo", ["React"]), (e: unknown) => {
    assert.ok(e instanceof GithubVerifyError, String(e));
    assert.equal(e.code, code);
    if (retryAfterSec !== undefined) assert.equal(e.retryAfterSec, retryAfterSec);
    return true;
  });
}

beforeEach(() => {
  calls = [];
  // 每個情境都要真的打（stub）請求：清掉 10 分鐘快取
  (globalThis as unknown as { __ghCache?: Map<string, unknown> }).__ghCache?.clear();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("第一個請求 403 且 X-RateLimit-Remaining=0 → rate_limited，重試秒數取自 X-RateLimit-Reset", async () => {
  const reset = Math.floor(Date.now() / 1000) + 120;
  stubFetch({
    status: 403,
    headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
    body: '{"message":"API rate limit exceeded"}',
  });
  await assert.rejects(verifyGithub("octo", []), (e: unknown) => {
    assert.ok(e instanceof GithubVerifyError);
    assert.equal(e.code, "rate_limited");
    assert.ok(e.retryAfterSec! > 100 && e.retryAfterSec! <= 121, String(e.retryAfterSec));
    return true;
  });
  assert.equal(calls.length, 1);
});

test("429（帶 Retry-After）→ rate_limited；repos 請求被限流也一樣", async () => {
  stubFetch({ status: 429, headers: { "retry-after": "30" } });
  await expectCode("rate_limited", 30);
  calls = [];
  stubFetch(user, { status: 429, headers: { "retry-after": "5" } });
  await expectCode("rate_limited", 5);
  assert.equal(calls.length, 2);
});

test("403 但不是限流（沒有限流標頭）→ fetch_failed", async () => {
  stubFetch({ status: 403, headers: { "x-ratelimit-remaining": "42" } });
  await expectCode("fetch_failed");
});

test("404 → not_found", async () => {
  stubFetch({ status: 404, body: '{"message":"Not Found"}' });
  await expectCode("not_found");
});

test("200 但內容是 HTML（代理／登入頁）→ fetch_failed", async () => {
  stubFetch({ status: 200, headers: { "content-type": "text/html" }, body: "<!doctype html><html></html>" });
  await expectCode("fetch_failed");
});

test("repos 回的不是陣列 → fetch_failed", async () => {
  stubFetch(user, { body: '{"message":"weird"}' });
  await expectCode("fetch_failed");
});

test("逾時／中止（AbortError、TimeoutError）與網路錯誤 → fetch_failed", async () => {
  stubFetch(new DOMException("aborted", "AbortError"));
  await expectCode("fetch_failed");
  calls = [];
  stubFetch(new DOMException("timed out", "TimeoutError"));
  await expectCode("fetch_failed");
  calls = [];
  stubFetch(new TypeError("fetch failed"));
  await expectCode("fetch_failed");
});

test("成功：fork 的 repo 不計入 topLanguages，技能依主要語言比對，結果快取 10 分鐘", async () => {
  stubFetch(user, {
    body: JSON.stringify([
      { language: "TypeScript", fork: false },
      { language: "TypeScript", fork: false },
      { language: "Rust", fork: true },
      { language: "Rust", fork: true },
      { language: "Rust", fork: true },
      { language: null, fork: false },
    ]),
  });
  const v = await verifyGithub("octo", ["React", "Rust", "Figma"]);
  assert.equal(v.source, "github-api");
  assert.equal(v.username, "Octo");
  assert.equal(v.publicRepos, 7);
  assert.equal(v.ownershipVerified, false);
  assert.deepEqual(v.topLanguages, [{ lang: "TypeScript", count: 2 }]);
  assert.deepEqual(v.matchedSkills, ["React"]);
  assert.deepEqual(v.unmatchedSkills, ["Rust"]);
  assert.deepEqual(v.unverifiableSkills, ["Figma"]);
  assert.match(calls[0], /^https:\/\/api\.github\.com\/users\/octo$/);
  assert.match(calls[1], /\/users\/octo\/repos\?/);

  // 同一帳號（大小寫不同）命中快取，不再發請求
  calls = [];
  stubFetch();
  const again = await verifyGithub("OCTO", ["React"]);
  assert.equal(again.publicRepos, 7);
  assert.equal(calls.length, 0);
});
