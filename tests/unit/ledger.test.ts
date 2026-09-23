import { test } from "node:test";
import assert from "node:assert/strict";
import { competenceScore } from "../../src/lib/ledger";

const z = { teams: 0, connections: 0, messages: 0, icebreakers: 0, avgTeamScore: 0 };

test("能力分：基準 35", () => {
  assert.equal(competenceScore(z), 35);
});

test("能力分：各項加權與上限", () => {
  assert.equal(competenceScore({ ...z, teams: 1, avgTeamScore: 80 }), 35 + 8 + 12); // 80×0.15=12
  assert.equal(competenceScore({ ...z, teams: 5, avgTeamScore: 100 }), 35 + 20 + 15); // 兩項都封頂
  assert.equal(competenceScore({ ...z, connections: 10 }), 35 + 15);
  assert.equal(competenceScore({ ...z, messages: 1 }), 36); // 35.5 四捨五入
  assert.equal(competenceScore({ ...z, messages: 100 }), 45);
  assert.equal(competenceScore({ ...z, icebreakers: 9 }), 40);
  // 沒有隊伍時 avgTeamScore 不計
  assert.equal(competenceScore({ ...z, avgTeamScore: 100 }), 35);
});

test("能力分：夾在 30–98", () => {
  assert.equal(
    competenceScore({ teams: 9, connections: 9, messages: 99, icebreakers: 9, avgTeamScore: 100 }),
    98,
  );
});
