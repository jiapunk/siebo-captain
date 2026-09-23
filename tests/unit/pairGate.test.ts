import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRIORITY_MIN,
  RADAR_MIN,
  bothPass,
  latestRunPerPeer,
  pairScores,
  radarBand,
  type PairRun,
} from "../../src/lib/pairGate";

const run = (a: number | null, b: number | null): PairRun => ({
  userAId: "ua",
  userBId: "ub",
  reportA: a === null ? null : { score: a },
  reportB: b === null ? null : { score: b },
});

test("門檻常數：雷達 50、優先 60", () => {
  assert.equal(RADAR_MIN, 50);
  assert.equal(PRIORITY_MIN, 60);
});

test("pairScores 依視角對調 mine / theirs", () => {
  const r = run(72, 55);
  assert.deepEqual(pairScores(r, "ua"), { mine: 72, theirs: 55, min: 55 });
  assert.deepEqual(pairScores(r, "ub"), { mine: 55, theirs: 72, min: 55 });
  assert.deepEqual(pairScores(r, "someone-else"), { mine: null, theirs: null, min: null });
});

test("pairScores：缺報告或 score 格式不符時為 null", () => {
  assert.deepEqual(pairScores(run(80, null), "ua"), { mine: 80, theirs: null, min: null });
  const bad: PairRun = { userAId: "ua", userBId: "ub", reportA: { score: "90" }, reportB: [] };
  assert.deepEqual(pairScores(bad, "ua"), { mine: null, theirs: null, min: null });
});

test("radarBand：看雙方較低分", () => {
  assert.equal(radarBand(run(60, 60), "ua"), "priority");
  assert.equal(radarBand(run(90, 59), "ua"), "watch");
  assert.equal(radarBand(run(50, 50), "ub"), "watch");
  assert.equal(radarBand(run(90, 49), "ua"), null);
  assert.equal(radarBand(run(90, null), "ua"), null);
  assert.equal(radarBand(run(90, 90), "nobody"), null);
});

test("bothPass：雙方都 ≥ 60", () => {
  assert.equal(bothPass(run(60, 60)), true);
  assert.equal(bothPass(run(95, 59)), false);
  assert.equal(bothPass(run(95, null)), false);
});

test("latestRunPerPeer：每位對象取最新一筆（不看分數）", () => {
  const mk = (id: string, a: string, b: string, t: number, sa: number, sb: number) => ({
    id,
    userAId: a,
    userBId: b,
    createdAt: new Date(t),
    reportA: { score: sa },
    reportB: { score: sb },
  });
  const runs = [
    mk("old-pass", "me", "leo", 1000, 83, 80),
    mk("new-fail", "me", "leo", 2000, 45, 80), // 新評估判不合格 → 舊的不得復活
    mk("from-kiwi", "kiwi", "me", 1500, 70, 72),
    mk("unrelated", "x", "y", 3000, 90, 90),
  ];
  const m = latestRunPerPeer(runs, "me");
  assert.deepEqual([...m.keys()].sort(), ["kiwi", "leo"]);
  assert.equal(m.get("leo")!.id, "new-fail");
  assert.equal(radarBand(m.get("leo")!, "me"), null);
  assert.equal(m.get("kiwi")!.id, "from-kiwi");
  assert.equal(radarBand(m.get("kiwi")!, "me"), "priority");
});
