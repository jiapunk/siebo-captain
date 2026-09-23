import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeTeamReport,
  enumerateHypotheses,
  hypothesisId,
  latestUniqueHypotheses,
  localTeamAnswers,
  measureTeamRetention,
  passesHardConstraints,
  pickNonOverlapping,
  staleProposalIds,
  type Candidate,
  type ProposalRow,
} from "../../src/lib/teamAssembler";
import type { DecideAnswer } from "../../src/lib/llm/decide";
import type { HackathonProfile } from "../../src/lib/types";

const prof = (role: string, goal = "想拿獎", availability = "全程投入（48 小時都在）"): HackathonProfile => ({
  nickname: role,
  role,
  skills: ["TypeScript"],
  timezone: "Asia/Taipei",
  availability,
  goal,
  workingStyle: "邊做邊改",
  vibe: "",
  dealbreakers: [],
  bio: "",
});
const cand = (id: string, role: string, score = 80, goal?: string): Candidate => ({
  userId: id,
  name: id,
  emoji: "🙂",
  profile: prof(role, goal),
  score,
});

test("假設 ID 由排序後的成員 id 組成（順序無關）", () => {
  assert.equal(hypothesisId("me", "b", "a"), "t:me:a:b");
  assert.equal(hypothesisId("me", "a", "b"), "t:me:a:b");
  const pool = ["f", "c", "a", "e", "b", "d"].map((id) => cand(id, "前端"));
  const hyps = enumerateHypotheses("me", pool);
  assert.equal(hyps.length, 15);
  assert.equal(new Set(hyps.map((h) => h.id)).size, 15);
  for (const h of hyps) {
    assert.ok(h.a.userId < h.b.userId);
    assert.equal(h.id, `t:me:${h.a.userId}:${h.b.userId}`);
  }
  // 候選順序（分數）改變 → 同一組隊友得到同一個 ID
  const reversed = enumerateHypotheses("me", [...pool].reverse());
  assert.deepEqual(new Set(reversed.map((h) => h.id)), new Set(hyps.map((h) => h.id)));
});

const answers = (overall: number, roleGap = 0.1, deadlock = 0.1): DecideAnswer[] => [
  { id: "s_overall", type: "score", value: overall, confidence: 1, probabilities: {} },
  { id: "n_role_gap", type: "noul", value: roleGap },
  { id: "n_deadlock", type: "noul", value: deadlock },
];

test("硬約束：分數 ≥ 60、無角色缺口、無死鎖", () => {
  assert.equal(passesHardConstraints(60, answers(6)), true);
  assert.equal(passesHardConstraints(59, answers(6)), false);
  assert.equal(passesHardConstraints(90, answers(8, 0.6)), false);
  assert.equal(passesHardConstraints(90, answers(8, 0.1, 0.9)), false);
});

test("不重疊貪婪：分數高者先選、隊友不重複、最多 3 隊、不改動輸入", () => {
  const s = (a: string, b: string, score: number) => ({
    hyp: { a: { userId: a }, b: { userId: b } },
    report: { score },
  });
  const input = [
    s("a", "b", 70),
    s("a", "c", 95), // 最高分，先選
    s("b", "c", 90), // 與 a-c 共用 c → 跳過
    s("b", "d", 85),
    s("e", "f", 60),
    s("g", "h", 99 - 40), // 59
    s("x", "y", 58),
  ];
  const copy = JSON.stringify(input);
  const picked = pickNonOverlapping(input);
  assert.equal(JSON.stringify(input), copy);
  assert.deepEqual(
    picked.map((p) => `${p.hyp.a.userId}${p.hyp.b.userId}`),
    ["ac", "bd", "ef"],
  );
  const used = picked.flatMap((p) => [p.hyp.a.userId, p.hyp.b.userId]);
  assert.equal(new Set(used).size, used.length);
});

test("隊伍理由：目標不一致用專屬文案、不重複、非中文語系不混入模板中文", () => {
  const my = prof("全端", "想拿獎");
  const hyp = {
    id: "t:me:a:b",
    a: cand("a", "設計", 80, "學習新東西"),
    b: cand("b", "PM", 80, "想拿獎"),
  };
  const zh = composeTeamReport("zh", my, hyp, localTeamAnswers(my, hyp), "mock");
  assert.equal(new Set(zh.rationale).size, zh.rationale.length);
  assert.ok(zh.rationale.some((r) => r.startsWith("目標不一致")));
  assert.ok(!zh.rationale.includes("投入時間有落差，建議先把關鍵時段敲定"));
  assert.match(zh.rationale[3], /^覆蓋 \d+ · 互補 \d+ · 化學 \d+ · 後勤 \d+（MOCK）$/);

  const en = composeTeamReport("en", my, hyp, localTeamAnswers(my, hyp), "jev");
  assert.equal(en.rationale[0], "Skill line: Full-stack × Design × PM");
  assert.match(en.rationale[2], /^Goals differ/);
  assert.match(en.rationale[3], /^Coverage \d+ · Complement \d+/);
  // 除了使用者資料（目標字串）以外沒有中文模板
  const templ = en.rationale.map((r) => r.replace(/想拿獎|學習新東西/g, "")).join(" ");
  assert.doesNotMatch(templ, /[一-鿿]/);
  assert.ok(en.risks.every((r) => !/[一-鿿]/.test(r)));
});

test("隊伍理由：未公開的角色顯示為隱藏字樣", () => {
  const my = { ...prof("全端"), role: "未公開" };
  const hyp = { id: "t:me:a:b", a: cand("a", "設計"), b: cand("b", "PM") };
  const ja = composeTeamReport("ja", my, hyp, localTeamAnswers(my, hyp), "mock");
  assert.match(ja.rationale[0], /^スキルライン：非公開 × /);
});

test("team_eval RETAIN：規則層直通算保留；遠端有題目退回規則算不保留", () => {
  const a = answers(7);
  assert.equal(measureTeamRetention(a, { source: "mock", fallbackIds: ["s_overall"] }).retained, true);
  assert.equal(measureTeamRetention(a, { source: "jev", fallbackIds: [] }).retained, true);
  const r = measureTeamRetention(a, { source: "jev", fallbackIds: ["n_deadlock"] });
  assert.equal(r.retained, false);
  assert.deepEqual(r.overridden, ["n_deadlock"]);
});

test("重新組隊：只收回我上一輪發起、沒有其他真人同意的提案", () => {
  const m = (userId: string, accepted = false, isBot = false) => ({ userId, accepted, user: { isBot } });
  const team = (id: string, captainId: string | undefined, members: ProposalRow["members"], status = "proposed"): ProposalRow => ({
    id,
    status,
    report: captainId === undefined ? { score: 70 } : { score: 70, captainId },
    members,
  });
  const rows: ProposalRow[] = [
    team("mine-bots", "me", [m("me"), m("bot1", false, true), m("bot2", false, true)]),
    team("mine-i-accepted", "me", [m("me", true), m("h1"), m("bot1", false, true)]),
    team("mine-other-accepted", "me", [m("me"), m("h1", true), m("bot1", false, true)]),
    team("legacy-no-captain", undefined, [m("me"), m("bot3", false, true), m("bot4", false, true)]),
    team("someone-elses", "h2", [m("h2"), m("me"), m("bot1", false, true)]),
    team("mine-assembled", "me", [m("me", true), m("bot1", true, true), m("bot2", true, true)], "assembled"),
    team("not-member", "me", [m("h3"), m("bot1", false, true), m("bot2", false, true)]),
    // bot 的 accepted 不算「其他真人已同意」
    team("mine-bot-accepted", "me", [m("me"), m("bot5", true, true), m("bot6", false, true)]),
  ];
  assert.deepEqual(staleProposalIds(rows, "me"), [
    "mine-bots",
    "mine-i-accepted",
    "legacy-no-captain",
    "mine-bot-accepted",
  ]);
});

test("舊資料的反向重複假設 ID：同一組隊友只留最新一筆", () => {
  const at = (id: string, t: number) => ({ id, updatedAt: new Date(t) });
  const out = latestUniqueHypotheses([
    at("t:me:b:a", 100), // 舊版反向 ID
    at("t:me:a:b", 200), // 新版排序 ID（較新）
    at("t:me:c:a", 300), // 只有反向版本：照樣保留
    at("t:me:b:c", 50),
    at("t:me:c:b", 10),
  ]);
  assert.deepEqual(out.map((p) => p.id).sort(), ["t:me:a:b", "t:me:b:c", "t:me:c:a"]);
});
