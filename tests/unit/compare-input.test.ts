import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionFieldsOnly, swarmScoredByDecisionLayer } from "../../src/lib/compare";
import type { HackathonProfile } from "../../src/lib/types";

const full: HackathonProfile = {
  nickname: "阿飛",
  role: "全端",
  skills: ["TypeScript", "Go"],
  timezone: "Asia/Taipei",
  availability: "全程投入",
  goal: "想拿獎",
  workingStyle: "先架構再動手",
  vibe: "咖啡因驅動",
  dealbreakers: ["報名後消失"],
  bio: "做過三次黑客松",
  github: {
    login: "afei",
    publicRepos: 12,
    followers: 3,
    accountAgeYears: 4,
    topLanguages: [{ lang: "TypeScript", repos: 8 }],
    recentActivity: true,
    verifiedAt: "2026-09-01T00:00:00.000Z",
    source: "mock",
  } as unknown as HackathonProfile["github"],
};

test("單體同輸入：只留決策層看得到的 6 個欄位（與 mock.reportState 相同），其餘清空、不帶 GitHub", () => {
  const p = decisionFieldsOnly(full);
  assert.deepEqual(
    {
      nickname: p.nickname,
      role: p.role,
      skills: p.skills,
      goal: p.goal,
      availability: p.availability,
      workingStyle: p.workingStyle,
    },
    {
      nickname: "阿飛",
      role: "全端",
      skills: ["TypeScript", "Go"],
      goal: "想拿獎",
      availability: "全程投入",
      workingStyle: "先架構再動手",
    },
  );
  assert.equal(p.timezone, "");
  assert.equal(p.vibe, "");
  assert.equal(p.bio, "");
  assert.deepEqual(p.dealbreakers, []);
  assert.equal(p.github, undefined);
});

test("蜂群 r:A 是否走決策層：jev／llm 決策／mock 規則＝是；real（realMatchReport）＝否；沒有軌跡看模式", () => {
  for (const p of ["jev", "llm", "mock"]) assert.equal(swarmScoredByDecisionLayer(p, "hybrid"), true, p);
  assert.equal(swarmScoredByDecisionLayer("real", "real"), false);
  assert.equal(swarmScoredByDecisionLayer("real", "hybrid"), false);
  assert.equal(swarmScoredByDecisionLayer(null, "hybrid"), true);
  assert.equal(swarmScoredByDecisionLayer(null, "real"), false);
  assert.equal(swarmScoredByDecisionLayer(undefined, "mock"), true);
});
