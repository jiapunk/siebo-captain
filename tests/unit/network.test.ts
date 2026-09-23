import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clusteringCoefficient,
  edgeKey,
  simulateSignal,
  type SimHypothesis,
} from "../../src/lib/network";

const E = (...pairs: [string, string][]) => pairs.map(([a, b]) => edgeKey(a, b));

test("聚類係數：三角形 = 1", () => {
  assert.equal(clusteringCoefficient(["a", "b", "c"], E(["a", "b"], ["b", "c"], ["a", "c"])), 1);
});

test("聚類係數：路徑 = 0", () => {
  assert.equal(clusteringCoefficient(["a", "b", "c", "d"], E(["a", "b"], ["b", "c"], ["c", "d"])), 0);
});

test("聚類係數：孤立點與 degree 1 的節點記 0 並計入平均（標準定義）", () => {
  // 三角形 + 1 個孤立點 → (1+1+1+0)/4 = 0.75
  assert.equal(
    clusteringCoefficient(["a", "b", "c", "z"], E(["a", "b"], ["b", "c"], ["a", "c"])),
    0.75,
  );
  // 兩個共用 hub 的三角形 + 4 個孤立點（對照 live 0.87 vs 標準 0.48 的案例）
  const nodes = ["h", "a", "b", "c", "d", "i1", "i2", "i3", "i4"];
  const edges = E(["h", "a"], ["h", "b"], ["a", "b"], ["h", "c"], ["h", "d"], ["c", "d"]);
  // h: 鄰居 4、實際連線 2 → 2*2/(4*3)=1/3；a,b,c,d = 1；孤立 0 → (1/3+4)/9 = 0.48
  assert.equal(clusteringCoefficient(nodes, edges), 0.48);
  assert.equal(clusteringCoefficient([], []), 0);
});

const groups: Record<string, string> = {
  me: "engineering",
  d1: "design",
  p1: "product",
  e1: "engineering",
  e2: "engineering",
};
const groupOf = (id: string) => groups[id] ?? null;

test("雙信號模擬：選出三人隊（三角形）時聚類 > 0，且兩種信號可區分", () => {
  const hyps: SimHypothesis[] = [
    // 社交分高、但兩位都是工程（同群）；帳本能力分低
    { a: "e1", b: "e2", raw: 90, compAvg: 30, eligible: true },
    // 社交分略低、跨群；帳本能力分高
    { a: "d1", b: "p1", raw: 84, compAvg: 90, eligible: true },
    { a: "d1", b: "e1", raw: 50, compAvg: 90, eligible: false }, // 硬約束不過
  ];
  const nodes = ["me", "d1", "p1", "e1", "e2"];
  const base = E(["d1", "e2"]);
  const social = simulateSignal({ ownerId: "me", hyps, mode: "social", nodes, baseEdges: base, groupOf });
  const comp = simulateSignal({ ownerId: "me", hyps, mode: "competence", nodes, baseEdges: base, groupOf });

  // 兩種信號在同一批假設下選到相同的兩隊（不重疊），但先後不同
  assert.deepEqual(social.picked, [["e1", "e2"], ["d1", "p1"]]);
  assert.deepEqual(comp.picked, [["d1", "p1"], ["e1", "e2"]]);
  assert.ok(social.clustering > 0);
  assert.ok(comp.clustering > 0);
  assert.equal(social.addedEdges, 6);
  assert.equal(social.edges, 7);

  // 只取一隊時（其餘被硬約束擋掉）兩種信號選到不同隊伍 → 跨群數不同
  const one = (mode: "social" | "competence") =>
    simulateSignal({
      ownerId: "me",
      hyps: [
        { a: "e1", b: "e2", raw: 90, compAvg: 30, eligible: true },
        { a: "e1", b: "d1", raw: 84, compAvg: 90, eligible: true },
      ],
      mode,
      nodes,
      baseEdges: [],
      groupOf,
    });
  const s1 = one("social");
  const c1 = one("competence");
  assert.deepEqual(s1.picked, [["e1", "e2"]]);
  assert.deepEqual(c1.picked, [["e1", "d1"]]);
  assert.equal(s1.crossGroup, 0); // 全工程
  assert.equal(c1.crossGroup, 2); // me-d1、e1-d1
  assert.ok(s1.clustering > 0 && c1.clustering > 0);
});

test("雙信號模擬：沒有合格假設時不加邊", () => {
  const r = simulateSignal({
    ownerId: "me",
    hyps: [{ a: "e1", b: "e2", raw: 90, compAvg: 30, eligible: false }],
    mode: "social",
    nodes: ["me", "e1", "e2"],
    baseEdges: [],
    groupOf,
  });
  assert.equal(r.edges, 0);
  assert.equal(r.clustering, 0);
  assert.deepEqual(r.picked, []);
});
