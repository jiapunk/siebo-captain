import { test } from "node:test";
import assert from "node:assert/strict";
import { measureReportRetention } from "../../src/lib/llm/mock";
import type { DecideAnswer } from "../../src/lib/llm/decide";
import type { HackathonProfile } from "../../src/lib/types";

const prof = (role: string): HackathonProfile => ({
  nickname: role,
  role,
  skills: [],
  timezone: "",
  availability: "",
  goal: "",
  workingStyle: "",
  vibe: "",
  dealbreakers: [],
  bio: "",
});
const sc = (id: string, value: number): DecideAnswer => ({ id, type: "score", value, confidence: 1, probabilities: {} });
const nl = (id: string, value: number): DecideAnswer => ({ id, type: "noul", value });
const base = (overrides: Partial<Record<string, number>> = {}): DecideAnswer[] => {
  const v = { d_skill: 7, d_goal: 6, d_avail: 5, d_comms: 6, d_reliability: 7, n_goal_diff: 0.1, n_avail_diff: 0.1, n_role_overlap: 0.1, ...overrides };
  return [
    sc("d_skill", v.d_skill!), sc("d_goal", v.d_goal!), sc("d_avail", v.d_avail!),
    sc("d_comms", v.d_comms!), sc("d_reliability", v.d_reliability!),
    nl("n_goal_diff", v.n_goal_diff!), nl("n_avail_diff", v.n_avail_diff!), nl("n_role_overlap", v.n_role_overlap!),
  ];
};
const fe = prof("前端");
const de = prof("設計");

test("RETAIN：決策值原樣進入報告 → retained", () => {
  const r = measureReportRetention(fe, de, base(), { source: "jev", fallbackIds: [] });
  assert.deepEqual(r, { retained: true, slots: 8, kept: 8, clamped: [], overridden: [] });
});

test("RETAIN：0–100 換算被 25–97 夾限 → 不保留", () => {
  const hi = measureReportRetention(fe, de, base({ d_skill: 9 }), { source: "jev", fallbackIds: [] });
  assert.equal(hi.retained, false);
  assert.deepEqual(hi.clamped, ["d_skill"]);
  const lo = measureReportRetention(fe, de, base({ d_goal: 1 }), { source: "jev", fallbackIds: [] });
  assert.deepEqual(lo.clamped, ["d_goal"]);
  assert.equal(lo.kept, 7);
});

test("RETAIN：規則覆寫決策層（同角色群強制 roleOverlap）→ 不保留", () => {
  const r = measureReportRetention(fe, prof("後端"), base(), { source: "jev", fallbackIds: [] });
  assert.equal(r.retained, false);
  assert.deepEqual(r.overridden, ["n_role_overlap"]);
  // 決策層自己也判定重疊 → 規則沒有改寫
  const same = measureReportRetention(fe, prof("後端"), base({ n_role_overlap: 0.9 }), { source: "jev", fallbackIds: [] });
  assert.equal(same.retained, true);
});

test("RETAIN：遠端逐題退回規則算不保留；規則層本身直通算保留", () => {
  const r = measureReportRetention(fe, de, base(), { source: "jev", fallbackIds: ["d_goal", "n_avail_diff"] });
  assert.equal(r.retained, false);
  assert.equal(r.kept, 6);
  const local = measureReportRetention(fe, de, base(), { source: "mock", fallbackIds: ["d_goal"] });
  assert.equal(local.retained, true);
});
