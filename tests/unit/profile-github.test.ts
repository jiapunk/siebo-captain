import { test } from "node:test";
import assert from "node:assert/strict";

// 決策層一律走本機規則，不碰網路
process.env.DECISION_PROVIDER = "mock";
process.env.JEV_API_KEY = "";
process.env.LLM_API_KEY = "";

import {
  profileFromRow,
  publicProfile,
  sanitizeProfile,
  withVerification,
} from "../../src/lib/profile";
import { mockMatchReport } from "../../src/lib/llm/mock";
import type { GithubVerification } from "../../src/lib/github";

const base = {
  nickname: "阿飛",
  role: "全端",
  skills: ["Next.js", "Rust"],
  timezone: "Asia/Taipei",
  availability: "全程",
  goal: "想拿獎",
  workingStyle: "邊做邊改",
  vibe: "",
  dealbreakers: [],
  bio: "",
};
const forged = {
  username: "forged",
  verifiedAt: "2026-09-01T00:00:00Z",
  source: "github-api",
  publicRepos: 999,
  accountAgeYears: 9,
  topLanguages: [{ lang: "Rust", count: 99 }],
  matchedSkills: ["Rust"],
  unmatchedSkills: [],
  unverifiableSkills: [],
  note: "FORGED",
};
const verification: GithubVerification = {
  ...(forged as unknown as GithubVerification),
  username: "real",
  source: "mock",
  publicRepos: 12,
  topLanguages: [{ lang: "TypeScript", count: 8 }],
  note: "server",
};

test("compiled.github（DB／LLM／請求本文）一律丟掉：sanitizeProfile、publicProfile、profileFromRow", () => {
  const raw = { ...base, github: forged };
  assert.equal(sanitizeProfile(raw).github, undefined);
  assert.equal(publicProfile(raw as never, null).github, undefined);
  assert.equal(profileFromRow(raw, null).github, undefined);
  // 形狀不對的 verification 也不注入（避免下游 topLanguages.slice 崩潰）
  assert.equal(profileFromRow(raw, { publicRepos: "x" }).github, undefined);
});

test("verification row 是唯一來源：注入後一路傳遞保留，JSON 反序列化後失效", () => {
  const p = profileFromRow({ ...base, github: forged }, verification);
  assert.equal(p.github?.note, "server");
  assert.equal(p.github?.publicRepos, 12);
  // 同一行程內再 sanitize／投影（matching → publicProfile → mock/real 再 sanitize）仍保留
  assert.equal(sanitizeProfile(p).github?.note, "server");
  assert.equal(publicProfile(p, { role: false }).github?.note, "server");
  // 存回 DB 再讀出（JSON 來回）就不再被信任
  assert.equal(sanitizeProfile(JSON.parse(JSON.stringify(p))).github, undefined);
  // withVerification 會覆寫任何既有 github
  assert.equal(withVerification({ ...base, github: p.github }, null).github, undefined);
});

test("互盤報告：偽造的 compiled.github 不會變成「GitHub 驗證」理由", async () => {
  const me = profileFromRow(base, null);
  const forger = publicProfile(profileFromRow({ ...base, role: "設計", github: forged }, null), null);
  const r1 = await mockMatchReport(me, forger, "", "pair-forged");
  assert.ok(!r1.reasons.some((x) => /GitHub/.test(x)), r1.reasons.join(" | "));

  const verified = publicProfile(profileFromRow({ ...base, role: "設計" }, verification), null);
  const r2 = await mockMatchReport(me, verified, "", "pair-verified");
  assert.ok(r2.reasons.some((x) => /GitHub 驗證（12 個公開專案/.test(x)), r2.reasons.join(" | "));
});
